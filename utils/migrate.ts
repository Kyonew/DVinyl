import Item from '../models/Item';
import Settings from '../models/Settings';
import User from '../models/User';
import Collection from '../models/Collection';
import { registry } from '../core/registry';
import { findOrCreateDefaultCollection } from './collectionHelpers';

export const migrateDatabase = async () => {
    try {
        const oldItemsCount = await Item.countDocuments({ kind: { $exists: false } });

        if (oldItemsCount > 0) {
            // Backfill the pre-plugins era items with the kind of the plugin that claims legacy items
            const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
            console.log(`[MIGRATION] : Found ${oldItemsCount} old items...`);
            console.log('[MIGRATION] Updating...');
            const result = await Item.updateMany(
                { kind: { $exists: false } },
                { $set: { kind: legacyKind } }
            );

            console.log(`[MIGRATION] ${result.modifiedCount} old items updated.`);
        }

        // advancedCD moved from a fake module toggle to a music plugin setting.
        // We only reach this branch on a legacy install (modules.advancedCD present),
        // and it deletes the key afterwards, so the legacy value always wins (idempotent).
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

            const usersBackfill = await User.updateMany(
                { lastActiveCollectionId: { $exists: false } },
                { $set: { lastActiveCollectionId: defaultCollection._id } }
            );
            if (usersBackfill.modifiedCount > 0) {
                console.log(`[MIGRATION] ${usersBackfill.modifiedCount} user(s) given an active collection.`);
            }

            // Make every existing user a member of the default collection (idempotent via $addToSet).
            const existingMemberIds = new Set(
                (defaultCollection.members || []).map((m: any) => String(m.user))
            );
            const allUsers = await User.find({}, '_id isAdmin').lean();
            let addedMembers = 0;
            for (const u of allUsers) {
                if (existingMemberIds.has(String(u._id))) continue;
                await Collection.updateOne(
                    { _id: defaultCollection._id },
                    { $addToSet: { members: { user: u._id, role: u.isAdmin ? 'admin' : 'viewer' } } }
                );
                addedMembers += 1;
            }
            if (addedMembers > 0) {
                console.log(`[MIGRATION] ${addedMembers} user(s) added as members of the default collection.`);
            }

            // Settings became per-collection: attach the historical global Settings
            // document(s) to the default collection so its theme/modules/visibility
            // carry over unchanged. New collections get their own doc lazily.
            const settingsBackfill = await Settings.updateMany(
                { collection: { $exists: false } },
                { $set: { collection: defaultCollection._id } }
            );
            if (settingsBackfill.modifiedCount > 0) {
                console.log(`[MIGRATION] ${settingsBackfill.modifiedCount} settings document(s) attached to the default collection.`);
            }
        }

    } catch (error) {
        console.error('[MIGRATION] ERROR :', error);
    }
};
