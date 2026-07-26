import Item from '../models/Item';
import Settings from '../models/Settings';
import User from '../models/User';
import Collection from '../models/Collection';
import { registry } from '../core/registry';
import { findOrCreateDefaultCollection } from './collectionHelpers';

/**
 * Legacy Settings could store theme.<key>.preset as an object (e.g. { default: 'default' })
 * instead of the string the current schema expects. Coerce every malformed preset to a string,
 * in place, and report whether anything changed. Shared by the boot migration (below) and the
 * whole-instance import, which inserts settings via Mongoose (Settings.create) and would
 * otherwise throw a CastError on such a doc before the migration ever runs.
 */
export const normalizeThemePresets = (theme: any): boolean => {
    if (!theme || typeof theme !== 'object') return false;
    let changed = false;
    for (const [key, val] of Object.entries<any>(theme)) {
        const preset = val?.preset;
        if (preset !== null && typeof preset === 'object') {
            theme[key].preset = typeof preset.default === 'string' ? preset.default : 'default';
            changed = true;
        }
    }
    return changed;
};

export const migrateDatabase = async () => {
    try {
        // Legacy Settings could store theme.<key>.preset as an object (e.g. { default: 'default' })
        // instead of the string the current schema expects. Normalize via the native driver
        // BEFORE any Mongoose hydration of Settings, otherwise findOne() below throws a
        // CastError and the try/catch aborts the entire migration. Idempotent: a second run
        // finds no object-typed presets left to fix.
        const settingsColl = (Settings.collection as any);
        const themeDocs = await settingsColl.find({ theme: { $exists: true } }).toArray();
        for (const doc of themeDocs) {
            if (!doc.theme || typeof doc.theme !== 'object') continue;
            const fixes: Record<string, string> = {};
            for (const [key, val] of Object.entries<any>(doc.theme)) {
                const preset = val?.preset;
                if (preset !== null && typeof preset === 'object') {
                    // Prefer a nested string (e.g. { default: 'default' } → 'default'), else fall back.
                    const coerced = typeof preset.default === 'string' ? preset.default : 'default';
                    fixes[`theme.${key}.preset`] = coerced;
                }
            }
            if (Object.keys(fixes).length > 0) {
                await settingsColl.updateOne({ _id: doc._id }, { $set: fixes });
                console.log(`[MIGRATION] normalized ${Object.keys(fixes).length} malformed theme preset(s) in settings ${doc._id}.`);
            }
        }

        const oldItemsCount = await Item.countDocuments({ kind: { $exists: false } });

        if (oldItemsCount > 0) {
            // Backfill the pre-plugins era items with the kind of the plugin that claims legacy items
            const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
            console.log(`[MIGRATION] : Found ${oldItemsCount} old items...`);
            console.log('[MIGRATION] Updating...');
            // MUST go through the native driver: `kind` is the Mongoose discriminatorKey,
            // and Mongoose silently strips it from $set on updates (guarding against changing
            // a document's discriminator). A plain Item.updateMany() therefore touches the docs
            // (updated_at bumps) but never actually writes `kind`, leaving pre-plugins items
            // discriminator-less, so registry.getByKind() can't resolve their plugin and they
            // render unformatted. The native collection bypasses that stripping.
            const result = await Item.collection.updateMany(
                { kind: { $exists: false } },
                { $set: { kind: legacyKind } }
            );

            console.log(`[MIGRATION] ${result.modifiedCount} old items updated.`);
        }

        // advancedCD moved from a fake module toggle to a music plugin setting.
        // We only reach this branch on a legacy install (modules.advancedCD present),
        // and it deletes the key afterwards, so the legacy value always wins (idempotent).
        //
        // Isolated in its own try/catch on purpose: this is the ONLY place we HYDRATE a
        // legacy Settings doc (findOne, not .lean(), the block needs .modules.get/delete
        // and .save()). If an install carries some other malformed Settings field beyond
        // the theme.preset case normalized above, hydration throws a CastError. Without
        // this guard that error would bubble to the outer catch and silently skip the
        // collection-merge block below, leaving items collection-less and non-admin users
        // without a membership (empty app) on every boot. The advancedCD backfill is
        // best-effort; the collection migration is not, it must always run.
        try {
            const s: any = await Settings.findOne();
            if (s && s.modules && typeof s.modules.get === 'function' && s.modules.get('advancedCD') !== undefined) {
                const legacy = s.modules.get('advancedCD');
                const ps = s.pluginSettings || {};
                ps.music = ps.music || {};
                ps.music.advancedCD = legacy;
                s.modules.delete('advancedCD');
                s.pluginSettings = ps;
                s.markModified('pluginSettings');
                await s.save();
                console.log(`[MIGRATION] advancedCD (${legacy}) moved to pluginSettings.music.`);
            }
        } catch (advancedCDError) {
            console.error('[MIGRATION] advancedCD backfill skipped (non-fatal):', advancedCDError);
        }

        // discogsUsername moved from a core User field to plugin-scoped pluginData.music.
        // discogsUsername is no longer in the User schema, so we go through the native driver
        // (Mongoose strict mode would silently strip the obsolete field from these ops).
        const usersColl = (User.collection as any);
        const legacyUsers = await usersColl
            .find({ discogsUsername: { $exists: true, $ne: '' } }, { projection: { discogsUsername: 1 } })
            .toArray();
        for (const u of legacyUsers) {
            await usersColl.updateOne(
                { _id: u._id },
                { $set: { 'pluginData.music.discogsUsername': u.discogsUsername } }
            );
        }
        // Drop the now-obsolete field from every user (including empty ones).
        const cleared = await usersColl.updateMany(
            { discogsUsername: { $exists: true } },
            { $unset: { discogsUsername: '' } }
        );
        if (legacyUsers.length > 0 || cleared.modifiedCount > 0) {
            console.log(`[MIGRATION] discogsUsername → pluginData.music for ${legacyUsers.length} user(s); field removed from ${cleared.modifiedCount}.`);
        }

        // Pre-multi-collection installs had no Collection document; every item implicitly
        // belonged to the single admin. Merge all pre-existing items into one default
        // collection and make every user a member with an active collection.
        // Idempotent: only touches items/users still missing the new fields.
        const defaultCollection = await findOrCreateDefaultCollection();
        if (defaultCollection) {
            const itemsBackfill = await Item.updateMany(
                { collection: { $exists: false } },
                { $set: { collection: defaultCollection._id } }
            );
            if (itemsBackfill.modifiedCount > 0) {
                console.log(`[MIGRATION] ${itemsBackfill.modifiedCount} item(s) attached to the default collection.`);
            }

            // A MISSING lastActiveCollectionId is the legacy marker: the field didn't exist
            // before multi-collections. Users created since then always carry it (the schema
            // defaults it to null), so this identifies pre-migration accounts exactly.
            // Captured BEFORE the updateMany below, which is what clears the marker.
            const legacyUserIds = new Set(
                (await User.find({ lastActiveCollectionId: { $exists: false } }, '_id').lean())
                    .map((u: any) => String(u._id))
            );

            const usersBackfill = await User.updateMany(
                { lastActiveCollectionId: { $exists: false } },
                { $set: { lastActiveCollectionId: defaultCollection._id } }
            );
            if (usersBackfill.modifiedCount > 0) {
                console.log(`[MIGRATION] ${usersBackfill.modifiedCount} user(s) given an active collection.`);
            }

            // Make every LEGACY user a member of the default collection (idempotent via $addToSet).
            // Restricted to legacy accounts on purpose: this loop used to run over every user on
            // every boot, which silently re-joined accounts an admin had removed, and handed a
            // viewer seat on the default collection to users meant to only have their own
            // (self-service creation, OIDC auto-provisioning). Membership is granted explicitly
            // from the admin pages; migration only heals the pre-multi-collection era.
            const existingMemberIds = new Set(
                (defaultCollection.members || []).map((m: any) => String(m.user))
            );
            const allUsers = await User.find({}, '_id isAdmin').lean();
            let addedMembers = 0;
            for (const u of allUsers) {
                if (existingMemberIds.has(String(u._id))) continue;
                if (!legacyUserIds.has(String(u._id))) continue;
                await Collection.updateOne(
                    { _id: defaultCollection._id },
                    { $addToSet: { members: { user: u._id, role: u.isAdmin ? 'admin' : 'viewer' } } }
                );
                addedMembers += 1;
            }
            if (addedMembers > 0) {
                console.log(`[MIGRATION] ${addedMembers} user(s) added as members of the default collection.`);
            }

            // Settings became per-collection: attach the historical global Settings doc to
            // the default collection so its theme/modules/visibility carry over unchanged.
            // Robust against a placeholder doc the app may have auto-created for the
            // collection on an earlier (aborted) boot + a first visit (settingsMiddleware
            // upserts a defaults doc): the unique `collection` index would otherwise make a
            // blind updateMany throw E11000 and leave the real theme orphaned. Resolve in
            // favour of the historical doc; idempotent on re-run.
            const orphans = await Settings.find({ collection: { $exists: false } }).select('_id').lean();
            const canonical = orphans[0];
            if (canonical) {
                const canonicalId = canonical._id;
                await Settings.deleteMany({
                    $or: [
                        { collection: defaultCollection._id },                         // placeholder(s) for this collection
                        { collection: { $exists: false }, _id: { $ne: canonicalId } }, // extra global docs
                    ],
                });
                await Settings.updateOne(
                    { _id: canonicalId },
                    { $set: { collection: defaultCollection._id } }
                );
                console.log(`[MIGRATION] historical settings attached to the default collection (theme/modules preserved).`);
            }
        }

    } catch (error) {
        console.error('[MIGRATION] ERROR :', error);
    }
};
