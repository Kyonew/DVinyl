import express from 'express';
import mongoose from 'mongoose';
import Item from '../models/Item';
import User from '../models/User';
import LoginLog from '../models/LoginLog';
import Settings from '../models/Settings';
import Collection from '../models/Collection';
import CustomPlugin from '../models/CustomPlugin';
import { requireAuth, requireAdmin, requireCollectionRole } from '../middleware/authMiddleware';
import { registry } from '../core/registry';
import { migrateDatabase } from '../utils/migrate';
import { applyCustomPluginsFromDB } from '../core/customPluginSync';

const router = express.Router();

// ============ WHOLE-INSTANCE BACKUP (instance admin) ============

router.get('/export', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = {
            users: await User.find({}).lean(),
            albums: await Item.find({}).lean(),
            logs: await LoginLog.find({}).lean(),
            settings: await Settings.find({}).lean(),
            collections: await Collection.find({}).lean(),
            customPlugins: await CustomPlugin.find({}).lean(),
            metadata: {
                version: "3.1.0",
                date: new Date()
            }
        };

        const fileName = `dvinyl_instance_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
        res.status(500).send("Export failed");
    }
});

/**
 * POST /import - whole-instance restore (wipe & replace).
 * Supports three dump generations:
 *  - v3.1 (has `collections` + `settings` as array): restored verbatim.
 *  - v2/v3.0 (single global `settings`, no collections): collection-related
 *    fields are stripped and the boot migration is re-run to rebuild a default
 *    collection and re-stamp everything.
 */
router.post('/import', async (req, res) => {
    try {
        const userCount = await User.countDocuments();

        if (userCount > 0) {
            const currentUser = res.locals.user;

            if (!currentUser || !currentUser.isAdmin) {
                console.warn(`[SECURITY] import unauthorized : ${req.ip}`);
                return res.status(403).json({
                    error: "Import unauthorized."
                });
            }
        }

        // Setup
        let data = req.body;

        if (data.backupData) {
            try {
                data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
            } catch (e) {
                return res.status(400).json({ error: "Invalid JSON format" });
            }
        }

        if (!data || (!data.users && !data.albums)) {
            return res.status(400).json({ error: "Backup file missing required fields" });
        }

        const hasCollections = Array.isArray(data.collections) && data.collections.length > 0;

        await Promise.all([
            LoginLog.deleteMany({}),
            Item.deleteMany({}),
            User.deleteMany({}),
            Settings.deleteMany({}),
            Collection.deleteMany({}),
            CustomPlugin.deleteMany({})
        ]);

        if (hasCollections) {
            await Collection.insertMany(data.collections);
        }

        if (data.users && data.users.length > 0) {
            const cleanUsers = hasCollections
                ? data.users
                : data.users.map((u: any) => {
                    const { lastActiveCollectionId, ...rest } = u;
                    return rest;
                });
            await User.insertMany(cleanUsers);
        }

        if (data.albums && data.albums.length > 0) {
            // Legacy backups may hold items without a `kind`; assign the plugin that claims legacy items
            const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
            const toId = (v: any) => (typeof v === 'string' && mongoose.Types.ObjectId.isValid(v))
                ? new mongoose.Types.ObjectId(v) : v;
            const cleanAlbums = data.albums.map((album: any) => {
                const fixed: any = album.kind ? { ...album } : { ...album, kind: legacyKind };
                // Without the collections themselves, stale collection ids would orphan items
                if (!hasCollections) delete fixed.collection;
                // Cast the ref/date fields back to their BSON types (they are strings in JSON).
                if (fixed._id) fixed._id = toId(fixed._id);
                if (fixed.owner) fixed.owner = toId(fixed.owner);
                if (fixed.collection) fixed.collection = toId(fixed.collection);
                if (fixed.added_at) fixed.added_at = new Date(fixed.added_at);
                if (fixed.updated_at) fixed.updated_at = new Date(fixed.updated_at);
                return fixed;
            });
            // Insert with the native driver, bypassing Mongoose validation. A backup is
            // authoritative: re-validating restored items against the live (possibly stricter)
            // discriminator schema (e.g. a custom type whose `creator` became required) would
            // reject legitimately-saved items and, since the wipe already ran, gut the instance.
            await Item.collection.insertMany(cleanAlbums);
        }

        if (data.logs && data.logs.length > 0) {
            await LoginLog.insertMany(data.logs);
        }

        // v3.1 exports settings as an array (one per collection); older dumps as one object
        const settingsDocs = Array.isArray(data.settings)
            ? data.settings
            : (data.settings ? [data.settings] : []);
        for (const s of settingsDocs) {
            const clean = { ...s };
            if (!hasCollections) delete clean.collection;
            await Settings.create(clean);
        }

        // No-code plugin definitions. Absent from dumps predating v3.1.
        if (Array.isArray(data.customPlugins) && data.customPlugins.length > 0) {
            await CustomPlugin.insertMany(data.customPlugins);
        }

        // Rebuild the multi-collection invariants (default collection, item/user/settings
        // stamps, memberships). Idempotent; also heals legacy dumps. migrateDatabase()
        // only logs on failure (it must not crash server startup when called at boot),
        // so check its core invariant here rather than trusting a bare "it didn't throw".
        await migrateDatabase();

        // Reconcile no-code plugins with the freshly imported DB: re-materialize the
        // plugins/<id>/ folders and hot-register them, pruning any from the old instance.
        await applyCustomPluginsFromDB();

        const restoredCollectionCount = await Collection.countDocuments();

        res.cookie('jwt', '', { maxAge: 1 });
        if (restoredCollectionCount === 0) {
            return res.status(200).json({
                success: true,
                warning: "Import completed but no collection could be rebuilt (the dump may be missing an admin user). Items may be inaccessible until an admin account exists.",
                message: "Import successful"
            });
        }
        res.status(200).json({ success: true, message: "Import successful" });

    } catch (err: any) {
        console.error("[ERR] Import :", err);
        res.status(500).json({ error: err.message });
    }
});

// ============ PER-COLLECTION BACKUP (collection admin) ============

router.get('/collection/export', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const activeCollectionId = res.locals.activeCollectionId;
        const collection = res.locals.activeCollection;

        const settings = await Settings.findOne({ collection: activeCollectionId }).lean() as any;
        if (settings) {
            delete settings._id;
            delete settings.collection;
            delete settings.__v;
        }

        const albums = (await Item.find({ collection: activeCollectionId }).lean()).map((a: any) => {
            // Ids/refs are re-created at import time (imports may target another
            // collection or instance), so strip everything instance-specific.
            const { _id, __v, owner, collection, ...rest } = a;
            return rest;
        });

        const data = {
            collectionName: collection?.name || 'Collection',
            albums,
            settings: settings || null,
            metadata: {
                version: "3.1.0",
                type: "collection",
                date: new Date()
            }
        };

        const slug = collection?.slug || 'collection';
        const fileName = `dvinyl_collection-${slug}_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("[ERR] Collection export:", err);
        res.status(500).send("Export failed");
    }
});

/**
 * POST /collection/import - replaces the ACTIVE collection's items (and settings,
 * when present in the file) with the backup's content. Accepts both per-collection
 * dumps (albums pre-stripped) and whole-instance dumps (albums re-stamped here).
 */
router.post('/collection/import', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const activeCollectionId = res.locals.activeCollectionId;

        let data = req.body;
        if (data.backupData) {
            try {
                data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
            } catch (e) {
                return res.status(400).json({ error: "Invalid JSON format" });
            }
        }

        if (!data || !Array.isArray(data.albums)) {
            return res.status(400).json({ error: "Backup file missing required fields" });
        }

        // Replacement semantics: the collection's current items are wiped first.
        await Item.deleteMany({ collection: activeCollectionId });

        if (data.albums.length > 0) {
            const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
            const cleanAlbums = data.albums.map((album: any) => {
                const { _id, __v, ...rest } = album;
                return {
                    ...rest,
                    kind: rest.kind || legacyKind,
                    owner: req.user._id,
                    collection: activeCollectionId
                };
            });
            await Item.insertMany(cleanAlbums);
        }

        // Restore the collection's settings container when the dump carries one
        const settingsDoc = Array.isArray(data.settings) ? data.settings[0] : data.settings;
        if (settingsDoc) {
            const clean = { ...settingsDoc };
            delete clean._id;
            delete clean.__v;
            clean.collection = activeCollectionId;
            await Settings.deleteMany({ collection: activeCollectionId });
            await Settings.create(clean);
        }

        res.status(200).json({ success: true, message: "Import successful", count: data.albums.length });
    } catch (err: any) {
        console.error("[ERR] Collection import:", err);
        res.status(500).json({ error: err.message });
    }
});

export = router;
