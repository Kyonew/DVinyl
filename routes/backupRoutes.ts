import express from 'express';
import mongoose from 'mongoose';
import Item from '../models/Item';
import User from '../models/User';
import LoginLog from '../models/LoginLog';
import Settings from '../models/Settings';
import Collection from '../models/Collection';
import CustomPlugin from '../models/CustomPlugin';
import InstanceSettings from '../models/InstanceSettings';
import { invalidateInstanceSettingsCache } from '../utils/instanceSettings';
import { requireAuth, requireAdmin, requireCollectionRole } from '../middleware/authMiddleware';
import { registry } from '../core/registry';
import { buildSortTitle, stringifyCsv } from '../core/helpers';
import { importableFields, fieldValue, ImportTargetField } from '../core/csvMapping';

// Stamped into every dump so a restore log says which build produced the file.
// Read from package.json rather than copied, which is how it came to say 3.1.0 on 3.1.1.
const pkg = require('../package.json');
import { migrateDatabase, normalizeThemePresets } from '../utils/migrate';
import { applyCustomPluginsFromDB } from '../core/customPluginSync';
import { collectExtraDateFields, reviveExtraDates } from '../core/pluginExtraFields';

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
            instanceSettings: await InstanceSettings.findOne({ key: 'instance' }).lean(),
            metadata: {
                version: pkg.version,
                date: new Date()
            }
        };

        const fileName = `dvinyl_instance_${new Date().toISOString().split('T')[0]}.json`;
        console.log(`[BACKUP] Instance export: ${data.users.length} user(s), ${data.albums.length} item(s), ${data.collections.length} collection(s)`);
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("[BACKUP] Instance export failed:", err);
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

        console.log(`[BACKUP] Instance import started (dump version ${data.metadata?.version || 'unknown'}, ${hasCollections ? 'with' : 'without'} collections): ${data.users?.length || 0} user(s), ${data.albums?.length || 0} item(s). Wiping current data...`);

        await Promise.all([
            LoginLog.deleteMany({}),
            Item.deleteMany({}),
            User.deleteMany({}),
            Settings.deleteMany({}),
            Collection.deleteMany({}),
            CustomPlugin.deleteMany({}),
            InstanceSettings.deleteMany({})
        ]);
        // The singleton is cached in memory; the wipe above must not leave a stale copy
        // authorizing (or blocking) collection creation until the next restart.
        invalidateInstanceSettingsCache();

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
            const extraDateFields = collectExtraDateFields(
                Array.isArray(data.settings) ? data.settings : (data.settings ? [data.settings] : [])
            );
            const cleanAlbums = data.albums.map((album: any) => {
                const fixed: any = album.kind ? { ...album } : { ...album, kind: legacyKind };
                // Without the collections themselves, stale collection ids would orphan items
                if (!hasCollections) delete fixed.collection;
                // Cast the ref/date fields back to their BSON types (they are strings in JSON).
                if (fixed._id) fixed._id = toId(fixed._id);
                if (fixed.owner) fixed.owner = toId(fixed.owner);
                if (fixed.modified_by) fixed.modified_by = toId(fixed.modified_by);
                // Ids are preserved on a whole-instance restore, so a containment link only
                // needs its BSON type back.
                if (fixed.parent) fixed.parent = toId(fixed.parent);
                if (fixed.collection) fixed.collection = toId(fixed.collection);
                if (fixed.added_at) fixed.added_at = new Date(fixed.added_at);
                if (fixed.updated_at) fixed.updated_at = new Date(fixed.updated_at);
                if (fixed.modified_at) fixed.modified_at = new Date(fixed.modified_at);
                if (fixed.synced_at) fixed.synced_at = new Date(fixed.synced_at);
                // Same treatment for the date-typed user-defined fields, which sit in a
                // Mixed path and would otherwise come back as strings
                if (fixed.extra) fixed.extra = { ...fixed.extra };
                reviveExtraDates(fixed, extraDateFields);
                // The native insert below skips the schema middleware that normally derives
                // this, and a dump older than the field carries none at all.
                fixed.sort_title = buildSortTitle(fixed.title);
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
            // A legacy Settings doc can hold theme.<key>.preset as an object (e.g. the games
            // plugin's { default: 'default' }). Settings.create() validates and would throw a
            // CastError here, after the wipe already ran, before migrateDatabase() gets to
            // normalize it, leaving the instance half-restored. Normalize up front, like the
            // boot migration does via the native driver.
            normalizeThemePresets(clean.theme);
            await Settings.create(clean);
        }

        // No-code plugin definitions. Absent from dumps predating v3.1.
        if (Array.isArray(data.customPlugins) && data.customPlugins.length > 0) {
            await CustomPlugin.insertMany(data.customPlugins);
        }

        // Instance-wide policy singleton. Absent from older dumps, in which case the
        // schema defaults (self-service off) apply on the next read.
        if (data.instanceSettings) {
            const { _id, created_at, updated_at, __v, ...values } = data.instanceSettings;
            await InstanceSettings.updateOne(
                { key: 'instance' },
                { $set: { ...values, key: 'instance' } },
                { upsert: true }
            );
            invalidateInstanceSettingsCache();
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
        console.log(`[BACKUP] Instance import finished: ${restoredCollectionCount} collection(s) rebuilt, ${await Item.countDocuments()} item(s) restored`);

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
            // Owner and collection are re-stamped at import time (a dump may be restored
            // into another collection, or another instance), so they go. The id stays: a
            // season points at the show that holds it, and the import can only rebuild
            // that link if it can tell which item was which. It is never restored as is,
            // the import draws a new one and rewrites the links against it.
            const { __v, owner, collection, ...rest } = a;
            return rest;
        });

        const data = {
            collectionName: collection?.name || 'Collection',
            albums,
            settings: settings || null,
            metadata: {
                version: pkg.version,
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
 * GET /collection/export-csv - the same collection, as a flat spreadsheet instead of a
 * restorable dump. One row per item; columns are the union of the importable fields
 * (base + plugin + user-defined) of every kind actually present, so a single-type
 * collection reads as a clean sheet and a mixed one simply carries more (sparse)
 * columns. Read-only: unlike the JSON export this never round-trips through /import.
 */
router.get('/collection/export-csv', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const activeCollectionId = res.locals.activeCollectionId;
        const collection = res.locals.activeCollection;
        const settings = res.locals.settings;

        const albums = await Item.find({ collection: activeCollectionId }).lean();

        const kinds = Array.from(new Set(albums.map((a: any) => a.kind)));
        const columns: ImportTargetField[] = [];
        const seen = new Set<string>();

        for (const kind of kinds) {
            const plugin = registry.getByKind(kind);
            if (!plugin) continue; // A kind whose plugin was since removed/disabled: skip its columns, keep its rows under "Type".
            for (const field of importableFields(plugin, settings, req.t)) {
                if (seen.has(field.name)) continue;
                seen.add(field.name);
                columns.push(field);
            }
        }

        const typeLabel = req.t('admin.backup.csv.type_column');
        const wishlistLabel = req.t('admin.backup.csv.wishlist_column');
        const header = [typeLabel, ...columns.map(f => f.label), wishlistLabel];

        const rows: string[][] = [header];
        for (const album of albums) {
            const plugin = registry.getByKind((album as any).kind);
            const typeName = plugin ? req.t(plugin.label, { defaultValue: plugin.id }) : String((album as any).kind || '');
            const cells = columns.map(field => fieldValue(album, field));
            rows.push([typeName, ...cells, (album as any).in_wishlist ? 'true' : 'false']);
        }

        // Leading BOM so Excel (which guesses ANSI otherwise) opens accented labels
        // and titles as UTF-8 instead of mojibake.
        const csv = '﻿' + stringifyCsv(rows);
        const slug = collection?.slug || 'collection';
        const fileName = `dvinyl_collection-${slug}_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'text/csv; charset=utf-8');
        res.send(csv);
    } catch (err) {
        console.error("[ERR] Collection CSV export:", err);
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
            const extraDateFields = collectExtraDateFields(
                Array.isArray(data.settings) ? data.settings : (data.settings ? [data.settings] : [])
            );
            // Ids are reassigned here (the same dump may be restored twice into different
            // collections), which would leave every "contained in" pointing at an item that
            // no longer exists. So the new ids are drawn up front and the links rewritten
            // against them, keeping a show and its seasons together through the restore.
            const idMap = new Map<string, mongoose.Types.ObjectId>();
            for (const album of data.albums) {
                if (album._id) idMap.set(String(album._id), new mongoose.Types.ObjectId());
            }

            const cleanAlbums = data.albums.map((album: any) => {
                const { _id, __v, ...rest } = album;
                const fixed: any = {
                    ...rest,
                    kind: rest.kind || legacyKind,
                    owner: req.user._id,
                    collection: activeCollectionId
                };
                if (_id && idMap.has(String(_id))) fixed._id = idMap.get(String(_id));
                // A holder left outside the dump would strand the item in no listing at all,
                // so it becomes standalone rather than invisible.
                fixed.parent = rest.parent ? idMap.get(String(rest.parent)) : undefined;
                if (!fixed.parent) delete fixed.parent;
                if (fixed.extra) fixed.extra = { ...fixed.extra };
                reviveExtraDates(fixed, extraDateFields);
                return fixed;
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
