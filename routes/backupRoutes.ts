import express from 'express';
import { db } from '../core/db';
import { all, eq, idOf, isId, isIn } from '../core/db/query';
import multer from 'multer';
import os from 'os';
import { promises as fs } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { invalidateInstanceSettingsCache } from '../utils/instanceSettings';
import { invalidateAiConfigCache } from '../core/ai/instance';
import { invalidateVapidCache } from '../core/push';
import { requireAuth, requireAdmin, requireCollectionRole } from '../middleware/authMiddleware';
import { registry } from '../core/registry';
import { buildSortTitle, csvLine, getPublicProtocol } from '../core/helpers';
import { sortCreatorOf } from '../core/sortCreators';
import { DEFAULT_SORT_ARTICLES } from '../core/sortArticles';
import { reconcileSortTitles } from '../core/sortTitles';
import { importableFields, fieldValue, ImportTargetField } from '../core/csvMapping';

// Stamped into every dump so a restore log says which build produced the file.
// Read from package.json rather than copied, which is how it came to say 3.1.0 on 3.1.1.
const pkg = require('../package.json');
import { liftLegacyAccountFields, migrateDatabase, migratePluginItems, normalizeThemePresets } from '../utils/migrate';
import { migrateExtraFieldIdentities } from '../utils/migrateExtraFieldIdentities';
import { seedFurnitureFromLocations } from '../core/shelfStore';
import { findDuplicateCellKey } from '../utils/shelfHelpers';
import { collectionInfoFromBackup, collectionInfoOf } from '../core/collectionInfo';
import { applyCustomPluginsFromDB, renameCollidingFields } from '../core/customPluginSync';
import { collectExtraDateFields, reviveExtraDates } from '../core/pluginExtraFields';
import { restoredTypeSlug } from '../core/requestTypes';
import { deleteUnusedManagedItemImages, managedItemImageFile, managedItemImagesForQuery } from '../core/itemImageStorage';
import { MAX_BACKUP_UPLOAD_BYTES, readBackupArchive, sendBackupArchive } from '../core/backupArchive';
import { jsonStream, StreamedDocument } from '../core/jsonStream';
import { backupFolderIssue, buildInstanceBackup } from '../core/instanceBackup';
import { BASE_URL } from '../config/constants';
import { ambienceImages } from '../core/ambience';
import { setupTokenAccepted } from '../core/setupToken';

const router = express.Router();
const backupArchiveUpload = multer({
    dest: os.tmpdir(),
    limits: { files: 1, fileSize: MAX_BACKUP_UPLOAD_BYTES }
});

const requireInstanceImportAccess = async (req: any, res: any, next: any) => {
    try {
        const userCount = await db.users.count(all());
        if (res.locals.user?.isAdmin) return next();
        if (userCount === 0) {
            // A restore on an empty instance creates its accounts, so it is held to the
            // same token as the setup form. Sent as a header: the body is the backup.
            if (setupTokenAccepted(req.get('x-setup-token'))) return next();
            console.warn(`[SECURITY] restore refused, wrong setup token: ${req.ip}`);
            return res.status(403).json({ error: 'Wrong setup token.', userMessage: req.t('setup.err_bad_token') });
        }
        console.warn(`[SECURITY] import unauthorized : ${req.ip}`);
        return res.status(403).json({ error: 'Import unauthorized.' });
    } catch (err) {
        next(err);
    }
};

const receiveBackupArchive = (req: any, res: any, next: any) => {
    backupArchiveUpload.single('backup')(req, res, (err: any) => {
        if (!err) return next();
        const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
        return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Backup archive too large' : 'Invalid backup archive' });
    });
};

const loadBackupArchive = async (req: any, res: any, next: any) => {
    if (!req.file?.path) return res.status(400).json({ error: 'Backup archive missing' });
    try {
        const imported = await readBackupArchive(req.file.path);
        req.body = imported.data;
        req.importedManagedImagePaths = imported.importedImages;
        next();
    } catch (err) {
        console.warn('[BACKUP] Invalid archive:', err);
        res.status(400).json({ error: 'Backup archive corrupted or invalid' });
    } finally {
        try {
            await fs.unlink(req.file.path);
        } catch (err: any) {
            if (err?.code !== 'ENOENT') console.warn('[BACKUP] Temporary archive cleanup failed:', err);
        }
    }
};

async function cleanupImportedImages(req: any): Promise<void> {
    const images = Array.isArray(req.importedManagedImagePaths) ? req.importedManagedImagePaths : [];
    if (images.length === 0) return;
    try {
        await deleteUnusedManagedItemImages(images);
    } catch (err) {
        console.warn('[BACKUP] Imported image cleanup failed:', err);
    }
}

// ============ WHOLE-INSTANCE BACKUP (instance admin) ============

// A download the browser gave up on (a cancelled save, a closed tab) ends the export
// early. Nothing went wrong on this side, so it is told apart from a failure.
const cancelledByClient = (err: any) => err?.code === 'ERR_STREAM_PREMATURE_CLOSE';

function exportFailed(res: any, label: string, err: unknown): void {
    if (cancelledByClient(err)) console.log(`[BACKUP] ${label} cancelled by the client.`);
    else console.error(`[BACKUP] ${label} failed:`, err);
    if (!res.headersSent) res.status(500).send('Export failed');
    else res.destroy(err as Error);
}

router.get('/export', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await buildInstanceBackup();

        const fileName = `dvinyl_instance_${new Date().toISOString().split('T')[0]}.json`;
        console.log(`[BACKUP] Instance export: ${(data.users as any[]).length} user(s), ${await db.items.count(all())} item(s), ${(data.collections as any[]).length} collection(s)`);
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        await pipeline(jsonStream(data), res);
    } catch (err) {
        exportFailed(res, 'Instance export', err);
    }
});

router.get('/export-archive', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await buildInstanceBackup();
        const fileName = `dvinyl_instance_${new Date().toISOString().split('T')[0]}.zip`;
        console.log(`[BACKUP] Instance archive export: ${(data.users as any[]).length} user(s), ${await db.items.count(all())} item(s), ${(data.collections as any[]).length} collection(s)`);
        await sendBackupArchive(res, data, fileName);
    } catch (err) {
        exportFailed(res, 'Instance archive export', err);
    }
});

/**
 * What would make a whole-instance restore fail once the instance is wiped, or null. A
 * dump the instance wrote itself never has any of it; a file edited by hand may. Every
 * record kept under its id, and every value the store holds unique, must appear once,
 * and every record inserted after the wipe with the record rules must pass them.
 */
function instanceDumpConflict(data: any, users: any[], settings: any[]): string | null {
    const twice = (label: string, records: unknown, keyOf: (record: any) => unknown): string | null => {
        if (!Array.isArray(records)) return null;
        const seen = new Set<string>();
        for (const record of records) {
            const key = record && typeof record === 'object' ? keyOf(record) : undefined;
            if (key === undefined || key === null || key === '') continue;
            const text = String(key);
            if (seen.has(text)) return `${label} "${text.slice(0, 80)}" appears twice`;
            seen.add(text);
        }
        return null;
    };
    const byId = (record: any) => record._id;
    const checks: (string | null)[] = [
        twice('collection _id', data.collections, byId),
        twice('collection slug', data.collections, c => c.slug),
        twice('item _id', data.albums, byId),
        twice('user _id', users, byId),
        twice('username', users, u => (typeof u.username === 'string' ? u.username.trim() : u.username)),
        twice('email', users, u => (typeof u.email === 'string' ? u.email.toLowerCase() : u.email)),
        twice('SSO identity', users, u => u.oidc?.sub),
        twice('furniture _id', data.furniture, byId),
        twice('list _id', data.lists, byId),
        twice('request _id', data.requests, byId),
        twice('request type _id', data.requestTypes, byId),
        twice('request type slug', data.requestTypes, t => (restoredTypeSlug(t.slug) ? `${t.collection}/${restoredTypeSlug(t.slug)}` : undefined)),
        twice('settings of collection', Array.isArray(data.settings) ? data.settings : [], st => st.collection),
        twice('custom plugin', data.customPlugins, p => p.id),
        twice('price snapshot _id', data.priceHistory, byId),
        twice('login log _id', data.logs, byId),
        twice('link token', (Array.isArray(data.collections) ? data.collections : [])
            .flatMap((c: any) => [...(Array.isArray(c?.shareLinks) ? c.shareLinks : []), ...(Array.isArray(c?.inviteLinks) ? c.inviteLinks : [])]),
            link => link.token)
    ];
    const conflict = checks.find(Boolean);
    if (conflict) return conflict;
    for (const user of users) {
        const invalid = db.users.validate(user);
        if (invalid) return `user "${String(user?.username ?? '?').slice(0, 80)}": ${invalid.field}`;
    }
    for (const collection of Array.isArray(data.collections) ? data.collections : []) {
        const invalid = db.collections.validate(collection);
        if (invalid) return `collection "${String(collection?.name ?? '?').slice(0, 80)}": ${invalid.field}`;
    }
    for (const doc of settings) {
        const invalid = db.settings.validate(doc);
        if (invalid) return `settings of collection "${String(doc?.collection ?? '?').slice(0, 80)}": ${invalid.field}`;
    }
    for (const plugin of Array.isArray(data.customPlugins) ? data.customPlugins : []) {
        if (!plugin || typeof plugin !== 'object') return 'a custom plugin that is no record';
        const invalid = db.customPlugins.validate(plugin);
        if (invalid) return `custom plugin "${String(plugin?.id ?? '?').slice(0, 80)}": ${invalid.field}`;
    }
    return null;
}

/**
 * The settings records a dump holds, in the shape they are stored in: v3.1 and later
 * export one per collection, older dumps a single object for the whole instance.
 */
function restorableSettings(data: any, keepCollection: boolean): any[] {
    const docs = Array.isArray(data.settings) ? data.settings : (data.settings ? [data.settings] : []);
    return docs.filter((s: any) => s && typeof s === 'object').map((s: any) => {
        const clean = { ...s };
        if (!keepCollection) delete clean.collection;
        // A legacy Settings doc can hold theme.<key>.preset as an object (e.g. the games
        // plugin's { default: 'default' }), which the record rules refuse. Normalized up
        // front, like the boot migration does, so it is not taken for a broken file.
        normalizeThemePresets(clean.theme);
        return clean;
    });
}

/**
 * POST /import - whole-instance restore (wipe & replace).
 * Supports three dump generations:
 *  - v3.1 (has `collections` + `settings` as array): restored verbatim.
 *  - v2/v3.0 (single global `settings`, no collections): collection-related
 *    fields are stripped and the boot migration is re-run to rebuild a default
 *    collection and re-stamp everything.
 */
const importInstanceBackup = async (req: any, res: any) => {
    try {
        // Setup
        let data = req.body;

        if (data.backupData) {
            try {
                data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
            } catch (e) {
                await cleanupImportedImages(req);
                return res.status(400).json({ error: "Invalid JSON format" });
            }
        }

        if (!data || (!Array.isArray(data.users) && !Array.isArray(data.albums))) {
            await cleanupImportedImages(req);
            return res.status(400).json({ error: "Backup file missing required fields" });
        }

        // A collection's own backup (what a collection's admin page exports) carries no
        // accounts. Restored here, it would wipe every user and every other collection and
        // leave its items in none, with nobody left able to sign in. Refused before
        // anything is touched, with a message saying where it goes instead.
        const isCollectionDump = typeof data.collectionName === 'string' || data.metadata?.type === 'collection';
        if (isCollectionDump || !Array.isArray(data.users) || data.users.length === 0) {
            await cleanupImportedImages(req);
            return res.status(400).json({
                error: "Collection backup (no user accounts) posted to the instance import",
                userMessage: req.t('admin.backup.error_collection_dump')
            });
        }

        const hasCollections = Array.isArray(data.collections) && data.collections.length > 0;
        const cleanUsers = data.users.map((u: any) => {
            const lifted = liftLegacyAccountFields(u);
            if (hasCollections) return lifted;
            const { lastActiveCollectionId, homeCollectionId, ...rest } = lifted;
            return rest;
        });
        // The wipe below cannot be taken back, so whatever the inserts after it would
        // refuse is refused here, while the instance is still whole.
        const settingsToRestore = restorableSettings(data, hasCollections);
        const conflict = instanceDumpConflict(data, cleanUsers, settingsToRestore);
        if (conflict) {
            await cleanupImportedImages(req);
            console.warn(`[BACKUP] Instance import refused before anything was touched: ${conflict}.`);
            return res.status(400).json({
                error: conflict,
                userMessage: req.t('admin.backup.error_invalid_dump', { detail: conflict })
            });
        }
        // Lists name items by id, and a whole-instance restore keeps every id as it was, so
        // they go back untouched. Settled here, before the wipe.
        const listsToRestore = hasCollections ? restorableLists(data.lists, list => list) : [];
        // Requests and their types keep their ids too. A dump older than them has none.
        // Their slugs are put in the builder's shape, on both sides of the link.
        const requestsToRestore = hasCollections
            ? restorableRecords(db.requests, data.requests, 'request', (request: any) => ({ ...request, type: restoredTypeSlug(request.type) }))
            : [];
        const requestTypesToRestore = hasCollections
            ? restorableRecords(db.requestTypes, data.requestTypes, 'request type', (type: any) => ({ ...type, slug: restoredTypeSlug(type.slug) }))
            : [];
        const replacedImagePaths = await managedItemImagesForQuery(all());
        // The wipe below takes the info pages with it, so their uploads are candidates
        // for release too, exactly like the items' own images.
        for (const current of await db.collections.find(all(), { fields: ['info.images'] })) {
            replacedImagePaths.push(...collectionInfoOf(current).images);
        }
        // And so do the collections' ambiences, their background pictures and logos.
        for (const current of await db.settings.find(all(), { fields: ['ambience'] })) {
            replacedImagePaths.push(...ambienceImages(current));
        }

        console.log(`[BACKUP] Instance import started (dump version ${data.metadata?.version || 'unknown'}, ${hasCollections ? 'with' : 'without'} collections): ${data.users?.length || 0} user(s), ${data.albums?.length || 0} item(s). Wiping current data...`);

        await Promise.all([
            db.loginLogs.deleteMany(all()),
            db.items.deleteMany(all()),
            db.users.deleteMany(all()),
            db.settings.deleteMany(all()),
            db.collections.deleteMany(all()),
            db.furniture.deleteMany(all()),
            db.lists.deleteMany(all()),
            db.requests.deleteMany(all()),
            db.requestTypes.deleteMany(all()),
            // They point at ids that may no longer mean the same thing: an inbox starts over.
            db.notifications.deleteMany(all()),
            // A device subscribed to the accounts being replaced.
            db.pushSubscriptions.deleteMany(all()),
            db.customPlugins.deleteMany(all()),
            db.priceHistory.deleteMany(all()),
            db.instanceSettings.deleteMany(all())
        ]);
        // The singleton is cached in memory; the wipe above must not leave a stale copy
        // authorizing (or blocking) collection creation until the next restart.
        invalidateInstanceSettingsCache();
        invalidateAiConfigCache();
        invalidateVapidCache();

        if (hasCollections) {
            await db.collections.insertMany(data.collections);
        }

        // Furniture belongs to a collection, so it only means anything alongside them.
        if (hasCollections && Array.isArray(data.furniture) && data.furniture.length > 0) {
            const toId = db.storedId;
            // Typed back like the items below: the insert as stored skips the record rules,
            // and `created_at` orders the pieces of one collection after `order`.
            await db.furniture.insertMany(data.furniture.map((piece: any) => ({
                ...piece,
                _id: toId(piece._id),
                collection: toId(piece.collection),
                createdBy: piece.createdBy ? toId(piece.createdBy) : undefined,
                ...(piece.created_at ? { created_at: new Date(piece.created_at) } : {}),
                ...(piece.updated_at ? { updated_at: new Date(piece.updated_at) } : {})
            })), { asStored: true });
        }

        // Whether the migration below still has free-text locations to turn into shelves.
        // A dump that carries a furniture list, even an empty one, comes from an instance
        // where that already happened: its collections hold the shelves they want, and an
        // empty list is furniture taken down on purpose, which stays that way. Whatever
        // flag each collection was dumped with is not trusted for this, since one created
        // after its instance's last boot could carry it unset. A dump from before the
        // shelves carries no list at all: its collections are handed to the migration,
        // which rebuilds the shelves from those very locations.
        if (hasCollections) {
            await db.collections.updateMany(all(), { set: { shelvesSeeded: Array.isArray(data.furniture) } });
        }

        // Inserted with the record rules, which also read the ids a JSON dump carries as
        // text back into the store's own form.
        if (listsToRestore.length > 0) {
            await db.lists.insertMany(listsToRestore);
        }
        if (requestTypesToRestore.length > 0) await db.requestTypes.insertMany(requestTypesToRestore);
        if (requestsToRestore.length > 0) await db.requests.insertMany(requestsToRestore);

        if (cleanUsers.length > 0) await db.users.insertMany(cleanUsers);

        if (data.albums && data.albums.length > 0) {
            // Legacy backups may hold items without a `kind`; assign the plugin that claims legacy items
            const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
            const toId = db.storedId;
            const extraDateFields = collectExtraDateFields(
                Array.isArray(data.settings) ? data.settings : (data.settings ? [data.settings] : [])
            );
            const albumIds = new Set(data.albums.map((album: any) => String(album?._id ?? '')));
            const cleanAlbums = data.albums.map((album: any) => {
                const fixed: any = album.kind ? { ...album } : { ...album, kind: legacyKind };
                // Without the collections themselves, stale collection ids would orphan items
                if (!hasCollections) delete fixed.collection;
                // Read the reference and date fields back into their types (text in JSON).
                if (fixed._id) fixed._id = toId(fixed._id);
                if (fixed.owner) fixed.owner = toId(fixed.owner);
                if (fixed.modified_by) fixed.modified_by = toId(fixed.modified_by);
                // Ids are preserved on a whole-instance restore, so a containment link only
                // needs its BSON type back. One naming an item the dump does not hold would
                // keep the item out of every listing, so it goes back on the shelf instead.
                // A value that is no id at all is left for the rename of the plugin field
                // that wrote it (utils/migrateReservedFieldNames.ts).
                for (const link of ['parent', 'inside']) {
                    if (!fixed[link]) continue;
                    if (!isDumpId(fixed[link])) continue;
                    if (albumIds.has(String(fixed[link]))) fixed[link] = toId(fixed[link]);
                    else delete fixed[link];
                }
                if (fixed.collection) fixed.collection = toId(fixed.collection);
                if (fixed.added_at) fixed.added_at = new Date(fixed.added_at);
                if (fixed.updated_at) fixed.updated_at = new Date(fixed.updated_at);
                if (fixed.modified_at) fixed.modified_at = new Date(fixed.modified_at);
                if (fixed.synced_at) fixed.synced_at = new Date(fixed.synced_at);
                // Same treatment for the date-typed user-defined fields, which sit in a
                // Mixed path and would otherwise come back as strings
                if (fixed.extra) fixed.extra = { ...fixed.extra };
                reviveExtraDates(fixed, extraDateFields);
                // The insert as stored below skips what normally derives this on a write,
                // and a dump older than the field carries none at all.
                fixed.sort_title = buildSortTitle(fixed.title);
                fixed.sort_creator = sortCreatorOf(fixed, DEFAULT_SORT_ARTICLES);
                return fixed;
            });
            // Inserted as stored, without the type rules. A backup is authoritative:
            // re-validating restored items against the live (possibly stricter) rules of
            // their type (e.g. a custom type whose `creator` became required) would reject
            // legitimately-saved items and, since the wipe already ran, gut the instance.
            await db.items.insertMany(cleanAlbums, { asStored: true });
        }

        // Login history is the one thing a restore can do without: a line the rules refuse
        // is left out (restorableRecords says so in the log) rather than refuse the file.
        const logsToRestore = restorableRecords(db.loginLogs, data.logs, 'login log');
        if (logsToRestore.length > 0) {
            await db.loginLogs.insertMany(logsToRestore);
        }

        // Value snapshots are collection-scoped, so a dump restored without its collections
        // has nothing for them to describe: they are dropped rather than left pointing at
        // ids this instance does not have. A dump older than the feature simply has none.
        if (hasCollections && Array.isArray(data.priceHistory) && data.priceHistory.length > 0) {
            const toId = db.storedId;
            const cleanHistory = data.priceHistory.map((snapshot: any) => {
                const fixed: any = { ...snapshot };
                if (fixed._id) fixed._id = toId(fixed._id);
                if (fixed.collection) fixed.collection = toId(fixed.collection);
                if (fixed.capturedAt) fixed.capturedAt = new Date(fixed.capturedAt);
                return fixed;
            });
            await db.priceHistory.insertMany(cleanHistory, { asStored: true });
        }

        // Put in shape and checked before the wipe (restorableSettings, instanceDumpConflict).
        for (const clean of settingsToRestore) {
            await db.settings.create(clean);
        }

        // No-code plugin definitions. Absent from dumps predating v3.1.
        if (Array.isArray(data.customPlugins) && data.customPlugins.length > 0) {
            await db.customPlugins.insertMany(data.customPlugins);
        }

        // Instance-wide policy singleton. Absent from older dumps, in which case the
        // schema defaults (self-service off) apply on the next read.
        if (data.instanceSettings) {
            const { _id, created_at, updated_at, __v, ...values } = data.instanceSettings;
            // The backup folder names a place on the machine the dump was made on. Kept
            // when this one can write there as the Backup tab would accept it; otherwise
            // the schedule stays and the backups go to the default folder.
            const backupFolder = values.backups?.folder;
            if (typeof backupFolder === 'string' && backupFolder && await backupFolderIssue(backupFolder)) {
                console.warn(`[BACKUP] The backup folder of the dump (${backupFolder}) cannot be used here; the default folder takes over.`);
                values.backups = { ...values.backups, folder: '' };
            }
            await db.instanceSettings.updateOne(eq('key', 'instance'), { set: { ...values, key: 'instance' } }, { upsert: true });
            invalidateInstanceSettingsCache();
            invalidateAiConfigCache();
        }

        // Rebuild the multi-collection invariants (default collection, item/user/settings
        // stamps, memberships). Idempotent; also heals legacy dumps. migrateDatabase()
        // only logs on failure (it must not crash server startup when called at boot),
        // so check its core invariant here rather than trusting a bare "it didn't throw".
        await migrateDatabase();

        // Reconcile no-code plugins with the freshly imported DB: re-materialize the
        // plugins/<id>/ folders and hot-register them, pruning any from the old instance.
        await renameCollidingFields();
        await applyCustomPluginsFromDB();
        await upgradeRestoredExtraFields();

        // A JSON restore can keep paths already present on this installation, while a ZIP
        // restore has already rewritten its files to fresh paths. In both cases, remove only
        // files that the replacement no longer references.
        try {
            await deleteUnusedManagedItemImages(replacedImagePaths);
        } catch (cleanupError) {
            console.warn('[ITEM IMAGE] Post-import cleanup failed:', cleanupError);
        }

        const restoredCollectionCount = await db.collections.count(all());
        console.log(`[BACKUP] Instance import finished: ${restoredCollectionCount} collection(s) rebuilt, ${await db.items.count(all())} item(s) restored`);

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
        await cleanupImportedImages(req);
        res.status(500).json({ error: err.message });
    }
};

router.post('/import', requireInstanceImportAccess, importInstanceBackup);
router.post(
    '/import-archive',
    requireInstanceImportAccess,
    receiveBackupArchive,
    loadBackupArchive,
    importInstanceBackup
);

// ============ PER-COLLECTION BACKUP (collection admin) ============

async function buildCollectionBackup(activeCollectionId: any, collection: any, exporterId: any): Promise<StreamedDocument> {
    const settings = await db.settings.findOne(eq('collection', idOf(activeCollectionId)));
    if (settings) {
        delete settings._id;
        delete settings.collection;
        delete settings.__v;
    }

    // Owner and collection are re-stamped at import time (a dump may be restored into
    // another collection, or another instance), so they go. The id stays: a season points
    // at the show that holds it, and the import can only rebuild that link if it can tell
    // which item was which. It is never restored as is, the import draws a new one and
    // rewrites the links against it. Gone through one at a time, like the instance export.
    const albums = async function* () {
        for await (const a of db.items.each(eq('collection', idOf(activeCollectionId)))) {
            const { __v, owner, collection, ...rest } = a;
            yield rest;
        }
    };

    // Stripped of what the import re-stamps. Everything a shelf is made of is its name
    // and its place in the grid, and the items find it by name, so nothing else is needed
    // for the restore to put the collection back exactly as it stood.
    const furniture = (await db.furniture.find(eq('collection', idOf(activeCollectionId)))).map((piece: any) => {
        const { _id, __v, collection: owner, createdBy, created_at, updated_at, ...rest } = piece;
        return rest;
    });

    // Kept with the item ids they point at: the import draws new ids for the items and
    // rewrites these against them, like it does for a season and its show.
    const lists = (await db.lists.find(eq('collection', idOf(activeCollectionId)))).map((list: any) => {
        const { _id, __v, collection: owner, createdBy, ...rest } = list;
        return rest;
    });

    // The request types go as they are. The requests follow their items like the lists,
    // and only come back for members of the collection they land in.
    const requestTypes = (await db.requestTypes.find(eq('collection', idOf(activeCollectionId)))).map((type: any) => {
        const { _id, __v, collection: owner, createdBy, ...rest } = type;
        return rest;
    });
    // A private request is only for its two members: when the admin exporting is neither,
    // what they wrote stays out and only the request itself goes.
    const exporter = idOf(exporterId);
    const requests = (await db.requests.find(eq('collection', idOf(activeCollectionId)))).map((request: any) => {
        const { _id, __v, collection: owner, ...rest } = request;
        const party = idOf(rest.sender) === exporter || idOf(rest.recipient) === exporter;
        if (rest.visibility === 'private' && !party) return { ...rest, message: '', response: '', data: {} };
        return rest;
    });

    return {
        collectionName: collection?.name || 'Collection',
        albums,
        furniture,
        lists,
        requestTypes,
        requests,
        // The collection's own page travels with it: it is written about these items,
        // and its pictures are picked up by the archive alongside theirs.
        info: collectionInfoOf(collection),
        settings: settings || null,
        metadata: {
            version: pkg.version,
            type: 'collection',
            date: new Date()
        }
    };
}

router.get('/collection/export', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const activeCollectionId = res.locals.activeCollectionId;
        const collection = res.locals.activeCollection;
        const data = await buildCollectionBackup(activeCollectionId, collection, req.user._id);

        const slug = collection?.slug || 'collection';
        const fileName = `dvinyl_collection-${slug}_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        await pipeline(jsonStream(data), res);
    } catch (err) {
        exportFailed(res, 'Collection export', err);
    }
});

router.get('/collection/export-archive', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const activeCollectionId = res.locals.activeCollectionId;
        const collection = res.locals.activeCollection;
        const data = await buildCollectionBackup(activeCollectionId, collection, req.user._id);
        const slug = collection?.slug || 'collection';
        const fileName = `dvinyl_collection-${slug}_${new Date().toISOString().split('T')[0]}.zip`;
        await sendBackupArchive(res, data, fileName);
    } catch (err) {
        exportFailed(res, 'Collection archive export', err);
    }
});

/**
 * GET /collection/export-csv - the same collection, as a flat spreadsheet instead of a
 * restorable dump. One row per item; columns are the union of the importable fields
 * (base + plugin + user-defined) of every kind actually present, so a single-type
 * collection reads as a clean sheet and a mixed one simply carries more (sparse)
 * columns. Fields shared by several plugins share a column only when they are the same
 * field, see the identity check below. Read-only: unlike the JSON export this never
 * round-trips through /import.
 */
router.get('/collection/export-csv', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const activeCollectionId = res.locals.activeCollectionId;
        const collection = res.locals.activeCollection;
        const settings = res.locals.settings;

        const inCollection = eq('collection', idOf(activeCollectionId));

        // Registry order rather than the order Mongo happened to return the items in,
        // so the same collection always exports its columns in the same order.
        const present = new Set(await db.items.distinct('kind', inCollection));
        const kinds = registry.getAll().map(p => p.kind).filter(kind => present.has(kind));

        // A column is one field of one plugin. Two plugins merge into a single column
        // only when their field is the same thing under the same name: the base fields
        // (Title, Year...) do, media_type does not, since it holds vinyl/cd for music
        // and movie/tv for DVDs. Merging those would print one plugin's labels and the
        // other's raw values in a column headed with a name that fits half the rows.
        const identity = (f: ImportTargetField) => JSON.stringify([
            f.name, f.type, f.label, f.extraField === true,
            (f.options || []).map(o => [o.value, o.label])
        ]);

        interface ExportColumn {
            field: ImportTargetField;
            label: string;
            /** Left empty for any other kind, even one owning a field of the same name. */
            kinds: Set<string>;
            /** Names the module in the header when two columns end up reading alike. */
            owner: string;
        }

        const columns: ExportColumn[] = [];
        const byIdentity = new Map<string, ExportColumn>();

        for (const kind of kinds) {
            const plugin = registry.getByKind(kind);
            if (!plugin) continue; // Cannot happen, kinds come from the registry: narrows the type.
            const pluginLabel = req.t(plugin.label, { defaultValue: plugin.id });
            for (const field of importableFields(plugin, settings, req.t)) {
                const key = identity(field);
                const known = byIdentity.get(key);
                if (known) {
                    known.kinds.add(kind);
                    continue;
                }
                const column: ExportColumn = { field, label: field.label, kinds: new Set([kind]), owner: pluginLabel };
                byIdentity.set(key, column);
                columns.push(column);
            }
        }

        const typeLabel = req.t('admin.backup.csv.type_column');
        const wishlistLabel = req.t('admin.backup.csv.wishlist_column');

        // Four modules label a field "Format", each with its own options, and the DVD
        // plugin calls its own field "Type" like the module column added here: without
        // this the sheet repeats a header and nobody can tell the columns apart. The two
        // columns this route adds itself are counted in, and win the bare name.
        const labelUses = new Map<string, number>([[typeLabel, 1], [wishlistLabel, 1]]);
        for (const column of columns) labelUses.set(column.label, (labelUses.get(column.label) || 0) + 1);
        for (const column of columns) {
            if ((labelUses.get(column.label) || 0) > 1) column.label = `${column.label} (${column.owner})`;
        }

        const header = [typeLabel, ...columns.map(c => c.label), wishlistLabel];

        // An image uploaded from an item form is stored as a portable `/uploads/items/...`
        // path, which is what the item document and the ZIP archive want: neither is tied
        // to the address this instance answers on. A spreadsheet is read outside the app,
        // where that path resolves nowhere, so the column headed "Cover (URL)" is given the
        // absolute URL this deployment actually serves the file at. Linked images already
        // carry their own absolute URL and are handed through untouched.
        const publicOrigin = `${getPublicProtocol(req)}://${req.get('host')}${BASE_URL.replace(/\/+$/, '')}`;
        const asPublicUrl = (value: string) => (managedItemImageFile(value) ? `${publicOrigin}${value}` : value);

        // One line per item, written as it is read, like the JSON export (see
        // buildInstanceBackup): the sheet of a large collection is never held whole.
        // Leading BOM so Excel (which guesses ANSI otherwise) opens accented labels
        // and titles as UTF-8 instead of mojibake.
        async function* lines() {
            let pending = '\ufeff' + csvLine(header);
            for await (const album of db.items.each(inCollection)) {
                const kind = String((album as any).kind || '');
                const plugin = registry.getByKind(kind);
                const typeName = plugin ? req.t(plugin.label, { defaultValue: plugin.id }) : kind;
                const cells = columns.map(c => (c.kinds.has(kind) ? asPublicUrl(fieldValue(album, c.field)) : ''));
                pending += '\r\n' + csvLine([typeName, ...cells, (album as any).in_wishlist ? 'true' : 'false']);
                if (pending.length >= 64 * 1024) {
                    yield Buffer.from(pending, 'utf8');
                    pending = '';
                }
            }
            yield Buffer.from(pending, 'utf8');
        }

        const slug = collection?.slug || 'collection';
        const fileName = `dvinyl_collection-${slug}_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'text/csv; charset=utf-8');
        await pipeline(Readable.from(lines(), { objectMode: false }), res);
    } catch (err) {
        exportFailed(res, 'Collection CSV export', err);
    }
});

/**
 * The custom-field identity upgrade, run on data a restore has just finished writing.
 * Logged rather than thrown: the restore itself went through, and reporting it as failed
 * would also release the images the archive brought in for it. The migration is
 * idempotent, so the next boot takes it up again.
 */
async function upgradeRestoredExtraFields(options: { collectionId?: any } = {}): Promise<void> {
    try {
        await migrateExtraFieldIdentities(options);
    } catch (err) {
        console.error('[BACKUP] Custom field identity migration failed after the restore:', err);
    }
}

/**
 * The furniture a collection restore puts back as it is, or null when the shelves have
 * to be rebuilt from the restored items' locations instead.
 *
 * Rebuilt when the dump has no furniture of this collection to offer: one from before
 * the shelves, or a whole-instance dump, whose pieces belong to several collections and
 * can name the same shelf twice once poured into one. Rebuilt too when the pieces would
 * not pass the model or claim one shelf twice (a file edited by hand): the insert would
 * only refuse them after the collection's items were already replaced.
 *
 * An empty list comes back empty: that collection had its furniture taken down on purpose.
 */
function restorableFurniture(data: any, collectionId: any, userId: any): any[] | null {
    if (!Array.isArray(data.furniture) || Array.isArray(data.collections)) return null;

    const pieces = data.furniture.map((piece: any, index: number) => {
        // The export strips these already. A file that still carries them must not bring
        // back an id this instance may hold for another piece.
        const { _id, __v, collection: _owner, createdBy: _by, created_at, updated_at, ...rest } = piece || {};
        return {
            ...rest,
            collection: collectionId,
            order: typeof rest.order === 'number' ? rest.order : 100 + index,
            createdBy: userId
        };
    });

    const cells = pieces.flatMap((piece: any) => (Array.isArray(piece.cells) ? piece.cells : []));
    const duplicate = findDuplicateCellKey(cells);
    const invalid = pieces.find((piece: any) => db.furniture.validate(piece));
    if (duplicate || invalid) {
        console.warn(`[BACKUP] The dump's furniture cannot be restored as it is (${duplicate ? `shelf "${duplicate}" appears twice` : 'invalid piece'}); rebuilding the shelves from the item locations.`);
        return null;
    }
    return pieces;
}

// An id as a dump writes one: 24 hex digits, as text or already in the store's form.
const isDumpId = (value: unknown) => isId(String(value ?? ''));

/**
 * The records of a dump that pass the rules of `store`, each in the shape `place` gives
 * it, or left out when `place` finds nothing left to point at. Settled before anything
 * is wiped, like the lists.
 */
function restorableRecords(store: any, records: unknown, label: string, place: (record: any) => any | null = r => r): any[] {
    if (!Array.isArray(records)) return [];
    const kept: any[] = [];
    let dropped = 0;
    for (const raw of records) {
        const record = raw && typeof raw === 'object' ? place({ ...raw }) : null;
        if (!record || store.validate(record)) {
            dropped++;
            continue;
        }
        kept.push(record);
    }
    if (dropped > 0) {
        console.warn(`[BACKUP] ${dropped} ${label}(s) of the dump could not be restored as they are and were left out.`);
    }
    return kept;
}

/**
 * The lists of a dump that can go back, each in the shape `place` gives it. Settled
 * before anything is wiped, for the same reason as the furniture: a list the model
 * refuses (a kind this version does not know, a name left blank in a file edited by
 * hand) would only fail its insert once the replacement had already started, and a
 * whole-instance restore inserts the lists before the accounts. Such a list is left out
 * rather than costing the rest of the restore, and so is a line naming no valid item.
 */
function restorableLists(lists: unknown, place: (list: any) => any): any[] {
    if (!Array.isArray(lists)) return [];

    const kept: any[] = [];
    let dropped = 0;
    for (const raw of lists) {
        if (!raw || typeof raw !== 'object') {
            dropped++;
            continue;
        }
        const entries = (Array.isArray(raw.entries) ? raw.entries : []).filter((entry: any) =>
            entry && isDumpId(entry.item) && (entry.track === undefined || entry.track === null || isDumpId(entry.track))
        );
        const list = place({ ...raw, entries });
        if (db.lists.validate(list)) {
            dropped++;
            continue;
        }
        kept.push(list);
    }
    if (dropped > 0) {
        console.warn(`[BACKUP] ${dropped} list(s) of the dump could not be restored as they are and were left out.`);
    }
    return kept;
}

/**
 * POST /collection/import - replaces the ACTIVE collection's items (and settings,
 * when present in the file) with the backup's content. Accepts both per-collection
 * dumps (albums pre-stripped) and whole-instance dumps (albums re-stamped here).
 */
const importCollectionBackup = async (req: any, res: any) => {
    try {
        const activeCollectionId = res.locals.activeCollectionId;

        let data = req.body;
        if (data.backupData) {
            try {
                data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
            } catch (e) {
                await cleanupImportedImages(req);
                return res.status(400).json({ error: "Invalid JSON format" });
            }
        }

        if (!data || !Array.isArray(data.albums)) {
            await cleanupImportedImages(req);
            return res.status(400).json({ error: "Backup file missing required fields" });
        }

        // Settled before anything is wiped, so furniture that cannot go back as it is
        // turns into a rebuild rather than an error halfway through the replacement.
        const furnitureToRestore = restorableFurniture(data, activeCollectionId, req.user._id);

        // Old item id -> new one. Ids are reassigned (the same dump may be restored twice
        // into different collections), which would leave every "contained in" and every
        // list line pointing at an item that no longer exists. So the new ids are drawn up
        // front and the links rewritten against them, keeping a show and its seasons, and
        // the lists, together through the restore.
        const idMap = new Map<string, any>();
        for (const album of data.albums) {
            if (album?._id) idMap.set(String(album._id), db.newId());
        }

        const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
        const extraDateFields = collectExtraDateFields(
            Array.isArray(data.settings) ? data.settings : (data.settings ? [data.settings] : [])
        );
        // A file edited by hand can name one id twice. The second copy gets an id of its
        // own, since sharing one would fail the insert after the wipe.
        const usedIds = new Set<string>();
        // Before 4.0 only a plugin field of that name wrote `purchase_currency`; since,
        // the core writes it beside the purchase price, and the field was renamed.
        const dumpMajor = Number.parseInt(String(data.metadata?.version || '0'), 10);
        const currencyWasAField = !(dumpMajor >= 4);
        const cleanAlbums = data.albums.map((album: any) => {
            const { _id, __v, ...rest } = album || {};
            const fixed: any = {
                ...rest,
                kind: rest.kind || legacyKind,
                owner: req.user._id,
                collection: activeCollectionId
            };
            const newId = _id ? idMap.get(String(_id)) : undefined;
            if (newId && !usedIds.has(String(newId))) {
                fixed._id = newId;
                usedIds.add(String(newId));
            }
            // A holder left outside the dump would strand the item in no listing at all,
            // so it becomes standalone rather than invisible. Same for a box: an item whose
            // box is not in the dump goes back on the shelf. A value that is no id at all
            // was typed into a plugin field of that name, renamed here since
            // (utils/migrateReservedFieldNames.ts), and goes to it.
            for (const link of ['parent', 'inside']) {
                const value = rest[link];
                fixed[link] = value ? idMap.get(String(value)) : undefined;
                if (!fixed[link]) delete fixed[link];
                const renamed = `${link}_field`;
                if (value && !isDumpId(value) && fixed[renamed] === undefined
                    && registry.getByKind(fixed.kind)?.formFields?.some(field => field.name === renamed)) {
                    fixed[renamed] = value;
                }
            }
            if (currencyWasAField && fixed.purchase_currency !== undefined && fixed.purchase_currency_field === undefined
                && registry.getByKind(fixed.kind)?.formFields?.some(field => field.name === 'purchase_currency_field')) {
                fixed.purchase_currency_field = fixed.purchase_currency;
                delete fixed.purchase_currency;
            }
            if (fixed.extra) fixed.extra = { ...fixed.extra };
            reviveExtraDates(fixed, extraDateFields);
            return fixed;
        });

        // Checked against their types before the wipe: the insert below checks too, and
        // an item it refused there would leave the collection emptied. Refused here, the
        // collection stays exactly as it was.
        for (const album of cleanAlbums) {
            const invalid = db.items.validate(album);
            if (invalid) {
                await cleanupImportedImages(req);
                const field = invalid.field;
                return res.status(400).json({
                    error: invalid.message,
                    userMessage: req.t('admin.collection_backup.error_invalid_item', {
                        title: String(album.title || '?').slice(0, 100),
                        field
                    })
                });
            }
        }

        // The collection's settings, when the dump carries them, are replaced after the
        // wipe too: put in shape and checked now, so a record the rules refuse leaves the
        // collection as it was instead of without settings.
        const settingsToRestore = restorableSettings(
            { settings: Array.isArray(data.settings) ? data.settings[0] : data.settings }, true
        ).map(({ _id, __v, ...clean }: any) => ({ ...clean, collection: activeCollectionId }))[0] || null;
        const invalidSettings = settingsToRestore ? db.settings.validate(settingsToRestore) : null;
        if (invalidSettings) {
            await cleanupImportedImages(req);
            const detail = `settings: ${invalidSettings.field}`;
            console.warn(`[BACKUP] Collection import refused before anything was touched: ${detail}.`);
            return res.status(400).json({
                error: invalidSettings.message,
                userMessage: req.t('admin.backup.error_invalid_dump', { detail })
            });
        }

        // A line whose item did not come back with the dump has nothing to point at and is
        // left out; tracks keep their own ids through the restore, so only the item half of
        // a playlist line is rewritten.
        const listsToRestore = restorableLists(data.lists, (list: any) => {
            const { _id, __v, collection: _owner, createdBy: _by, ...rest } = list;
            return {
                ...rest,
                collection: activeCollectionId,
                createdBy: req.user._id,
                entries: rest.entries
                    .filter((entry: any) => idMap.has(String(entry.item)))
                    .map((entry: any) => ({ ...entry, item: idMap.get(String(entry.item)) }))
            };
        });

        // A whole-instance dump mixes the request types of every collection, and two of
        // them may share a slug, so it leaves this collection's types in place, as it does
        // for the furniture. A type is unique by slug within a collection: a second one
        // with the same slug (a file edited by hand) would fail its insert after the wipe.
        const fromInstance = Array.isArray(data.collections);
        const restoresTypes = !fromInstance && Array.isArray(data.requestTypes);
        const typeSlugs = new Set<string>();
        const requestTypesToRestore = restoresTypes
            ? restorableRecords(db.requestTypes, data.requestTypes, 'request type', (type: any) => {
                const { _id, __v, collection: _owner, createdBy: _by, ...rest } = type;
                const slug = restoredTypeSlug(rest.slug);
                if (typeSlugs.has(slug)) return null;
                typeSlugs.add(slug);
                return { ...rest, slug, collection: activeCollectionId, createdBy: req.user._id };
            })
            : [];
        // A request follows its item to the new id, between members of this collection only.
        const memberIds = new Set((res.locals.activeCollection?.members || []).map((m: any) => idOf(m.user)));
        const requestsToRestore = fromInstance ? [] : restorableRecords(db.requests, data.requests, 'request', (request: any) => {
            const { _id, __v, collection: _owner, ...rest } = request;
            const item = idMap.get(String(rest.item));
            if (!item || !memberIds.has(idOf(rest.sender)) || !memberIds.has(idOf(rest.recipient))) return null;
            return { ...rest, item, type: restoredTypeSlug(rest.type), collection: activeCollectionId };
        });

        // Replacement semantics: the collection's current items are wiped first.
        const replacedImagePaths = await managedItemImagesForQuery(eq('collection', idOf(activeCollectionId)));
        const ofCollection = eq('collection', idOf(activeCollectionId));
        await db.items.deleteMany(ofCollection);
        await db.items.insertMany(cleanAlbums);

        // Replacement semantics for the lists too.
        await db.lists.deleteMany(ofCollection);
        await db.lists.insertMany(listsToRestore);

        // And for the request types. A dump older than them carries none and leaves the
        // collection's own in place.
        if (restoresTypes) {
            await db.requestTypes.deleteMany(ofCollection);
            if (requestTypesToRestore.length > 0) await db.requestTypes.insertMany(requestTypesToRestore);
        }
        // The requests always go: every one of them is about an item that was just
        // replaced, so none would point at anything left. Nor would the notifications
        // that open them, which go too.
        const replacedRequests = await db.requests.find(ofCollection, { fields: ['_id'] });
        if (replacedRequests.length > 0) {
            await db.notifications.deleteMany(isIn('link', replacedRequests.map((r: any) => `/requests/${idOf(r._id)}`)));
        }
        await db.requests.deleteMany(ofCollection);
        if (requestsToRestore.length > 0) await db.requests.insertMany(requestsToRestore);

        // Replacement semantics again: the collection's own furniture goes with its items.
        await db.furniture.deleteMany(ofCollection);

        if (furnitureToRestore) {
            await db.furniture.insertMany(furnitureToRestore);
        } else {
            // The restored items still say where each one is kept. Rebuilt into furniture
            // the same way the boot migration does it, so the restore does not land a
            // collection whose every item is unsorted.
            const seeded = await seedFurnitureFromLocations(
                activeCollectionId,
                res.locals.activeCollection?.name || 'Collection'
            );
            if (seeded.shelves > 0) {
                console.log(`[BACKUP] ${seeded.shelves} shelf/shelves rebuilt from the restored locations.`);
            }
        }

        // The collection's shelves are now whatever this restore made of them, so the boot
        // migration has nothing left to convert here, and must not rebuild pieces its
        // owners take down from now on.
        await db.collections.updateOne(eq('_id', idOf(activeCollectionId)), { set: { shelvesSeeded: true } });

        // The info page is replaced like everything else, and the pictures the previous
        // one held are released once the new page is in place (nothing else points at
        // them, and the release checks every other reference before it unlinks a file).
        const previousInfo = collectionInfoOf(await db.collections.findById(idOf(activeCollectionId)));
        if (data.info && typeof data.info === 'object') {
            const info = collectionInfoFromBackup(data.info);
            await db.collections.updateOne(eq('_id', idOf(activeCollectionId)), { set: { info } });
            replacedImagePaths.push(...previousInfo.images.filter(image => !info.images.includes(image)));
        }

        // Restore the collection's settings container when the dump carries one
        if (settingsToRestore) {
            // Its ambience pictures go the way of the info page's above.
            const previousSettings = await db.settings.findOne(eq('collection', idOf(activeCollectionId)));
            replacedImagePaths.push(...ambienceImages(previousSettings));
            await db.settings.deleteMany(eq('collection', idOf(activeCollectionId)));
            await db.settings.create(settingsToRestore);
        }

        // Collection restores do not run the whole boot migration. Apply the same
        // custom-field identity upgrade explicitly before the restored data is used.
        await upgradeRestoredExtraFields({ collectionId: activeCollectionId });
        // The items were filed with the articles the collection ignored before its
        // settings came back with the dump, which may name others.
        await reconcileSortTitles(activeCollectionId);
        // Nor the plugins' own item upgrades, which an older dump needs as much.
        await migratePluginItems();

        try {
            await deleteUnusedManagedItemImages(replacedImagePaths);
        } catch (cleanupError) {
            console.warn('[ITEM IMAGE] Collection import cleanup failed:', cleanupError);
        }

        res.status(200).json({ success: true, message: "Import successful", count: data.albums.length });
    } catch (err: any) {
        console.error("[ERR] Collection import:", err);
        await cleanupImportedImages(req);
        res.status(500).json({ error: err.message });
    }
};

router.post('/collection/import', requireAuth, requireCollectionRole('admin'), importCollectionBackup);
router.post(
    '/collection/import-archive',
    requireAuth,
    requireCollectionRole('admin'),
    receiveBackupArchive,
    loadBackupArchive,
    importCollectionBackup
);

export = router;
