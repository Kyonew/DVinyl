import { db } from '../core/db';
import {
    all, and, eq, exists, idOf, isIn, missing, ne, notIn, ofType, or
} from '../core/db/query';
import { registry } from '../core/registry';
import { buildSortTitle } from '../core/helpers';
import { findOrCreateDefaultCollection } from './collectionHelpers';
import { seedFurnitureFromLocations } from '../core/shelfStore';
import { legacySource, legacyIdFieldFor } from '../core/sources';

/**
 * Legacy Settings could store theme.<key>.preset as an object (e.g. { default: 'default' })
 * instead of the string the current schema expects. Coerce every malformed preset to a string,
 * in place, and report whether anything changed. Shared by the boot migration (below) and the
 * whole-instance import, which creates settings through their record rules and would
 * otherwise have such a doc refused before the migration ever runs.
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
        // instead of the string the current rules expect. Read and written as stored, past
        // those rules, which would refuse such a doc. Idempotent: a second run finds no
        // object-typed presets left to fix.
        const themeDocs = await db.settings.find(exists('theme'));
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
                await db.settings.updateOne(eq('_id', idOf(doc._id)), { set: fixes }, { asStored: true });
                console.log(`[MIGRATION] normalized ${Object.keys(fixes).length} malformed theme preset(s) in settings ${doc._id}.`);
            }
        }

        const oldItemsCount = await db.items.count(missing('kind'));

        if (oldItemsCount > 0) {
            // Backfill the pre-plugins era items with the kind of the plugin that claims legacy items
            const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
            console.log(`[MIGRATION] : Found ${oldItemsCount} old items...`);
            console.log('[MIGRATION] Updating...');
            // Written as stored: an ordinary update never changes the type of an item (the
            // store guards `kind`), so it would touch the items without ever writing it,
            // leaving pre-plugins items with no type that registry.getByKind() can resolve.
            const result = await db.items.updateMany(missing('kind'), { set: { kind: legacyKind } }, { asStored: true });

            console.log(`[MIGRATION] ${result.modified} old items updated.`);
        }

        // advancedCD moved from a fake module toggle to a music plugin setting.
        // We only reach this branch on a legacy install (modules.advancedCD present),
        // and it deletes the key afterwards, so the legacy value always wins (idempotent).
        //
        // Isolated in its own try/catch on purpose: if an install carries some other
        // malformed Settings field beyond the theme.preset case normalized above, writing
        // this one can fail. Without this guard that error would bubble to the outer catch
        // and silently skip the collection-merge block below, leaving items
        // collection-less and non-admin users without a membership (empty app) on every
        // boot. The advancedCD backfill is best-effort; the collection migration is not,
        // it must always run.
        try {
            const s: any = await db.settings.findOne(all());
            if (s && s.modules && s.modules.advancedCD !== undefined) {
                const legacy = s.modules.advancedCD;
                await db.settings.updateOne(eq('_id', idOf(s._id)), {
                    set: { 'pluginSettings.music.advancedCD': legacy },
                    unset: ['modules.advancedCD']
                });
                console.log(`[MIGRATION] advancedCD (${legacy}) moved to pluginSettings.music.`);
            }
        } catch (advancedCDError) {
            console.error('[MIGRATION] advancedCD backfill skipped (non-fatal):', advancedCDError);
        }

        // discogsUsername moved from a core User field to plugin-scoped pluginData.music.
        // discogsUsername is no longer an account field, so it is read and dropped as stored
        // (the account rules would ignore an undeclared field).
        const legacyUsers = await db.users.find(and(exists('discogsUsername'), ne('discogsUsername', '')));
        for (const u of legacyUsers) {
            await db.users.updateOne(
                eq('_id', idOf(u._id)),
                { set: { 'pluginData.music.discogsUsername': u.discogsUsername } },
                { asStored: true }
            );
        }
        // Drop the now-obsolete field from every user (including empty ones).
        const cleared = await db.users.updateMany(exists('discogsUsername'), { unset: ['discogsUsername'] }, { asStored: true });
        if (legacyUsers.length > 0 || cleared.modified > 0) {
            console.log(`[MIGRATION] discogsUsername → pluginData.music for ${legacyUsers.length} user(s); field removed from ${cleared.modified}.`);
        }

        // Pre-multi-collection installs had no Collection document; every item implicitly
        // belonged to the single admin. Merge all pre-existing items into one default
        // collection and make every user a member with an active collection.
        // Idempotent: only touches items/users still missing the new fields.
        const defaultCollection = await findOrCreateDefaultCollection();
        if (defaultCollection) {
            const itemsBackfill = await db.items.updateMany(missing('collection'), { set: { collection: defaultCollection._id } });
            if (itemsBackfill.modified > 0) {
                console.log(`[MIGRATION] ${itemsBackfill.modified} item(s) attached to the default collection.`);
            }

            // Is this run the one-time merge of a pre-multi-collection instance? Decided
            // from the leftovers of that era, and BEFORE the backfills below erase them.
            //
            // The state of a user cannot answer it: `lastActiveCollectionId` is missing
            // only on accounts the record rules never touched, and a legacy dump is
            // restored through them, which applies the default. Every restored
            // account therefore comes back with the field present (null) and reads as
            // modern, which used to leave everyone but the seeding admin with no
            // membership at all after a 2.6.0 restore.
            const legacyItemCount = await db.items.count(missing('collection'));
            const legacySettingsCount = await db.settings.count(missing('collection'));
            const isLegacyMerge = legacyItemCount > 0 || legacySettingsCount > 0;

            const usersBackfill = await db.users.updateMany(
                // A null is only stale during the legacy merge; outside of it, it is the
                // honest state of a user an admin has not placed in any collection yet.
                isLegacyMerge
                    ? or(missing('lastActiveCollectionId'), eq('lastActiveCollectionId', null))
                    : missing('lastActiveCollectionId'),
                { set: { lastActiveCollectionId: defaultCollection._id } }
            );
            if (usersBackfill.modified > 0) {
                console.log(`[MIGRATION] ${usersBackfill.modified} user(s) given an active collection.`);
            }

            // Make every user a member of the default collection (idempotent via $addToSet),
            // but only while merging a pre-multi-collection instance: back then a single
            // implicit collection held everything and everyone, so joining it restores what
            // those accounts already had. Outside that merge the loop stays shut, which is
            // what stops it from silently re-joining accounts an admin had removed and from
            // handing a viewer seat on the default collection to users meant to only have
            // their own (self-service creation, OIDC auto-provisioning).
            let addedMembers = 0;
            if (isLegacyMerge) {
                const existingMemberIds = new Set(
                    (defaultCollection.members || []).map((m: any) => String(m.user))
                );
                const allUsers = await db.users.find(all(), { fields: ['_id', 'isAdmin'] });
                for (const u of allUsers) {
                    if (existingMemberIds.has(String(u._id))) continue;
                    await db.collections.updateOne(
                        eq('_id', idOf(defaultCollection._id)),
                        { addToSet: { members: { user: u._id, role: u.isAdmin ? 'admin' : 'viewer' } } }
                    );
                    addedMembers += 1;
                }
            }
            if (addedMembers > 0) {
                console.log(`[MIGRATION] ${addedMembers} user(s) added as members of the default collection.`);
            }

            // Settings became per-collection: attach the historical global Settings doc to
            // the default collection so its theme/modules/visibility carry over unchanged.
            // Robust against a placeholder doc the app may have auto-created for the
            // collection on an earlier (aborted) boot + a first visit (settingsMiddleware
            // upserts a defaults doc): the unique `collection` rule would otherwise make a
            // blind update refuse it and leave the real theme orphaned. Resolve in
            // favour of the historical doc; idempotent on re-run.
            const orphans = await db.settings.find(missing('collection'), { fields: ['_id'] });
            const canonical = orphans[0];
            if (canonical) {
                const canonicalId = idOf(canonical._id);
                await db.settings.deleteMany(or(
                    eq('collection', idOf(defaultCollection._id)),                // placeholder(s) for this collection
                    and(missing('collection'), ne('_id', canonicalId))          // extra global docs
                ));
                await db.settings.updateOne(eq('_id', canonicalId), { set: { collection: defaultCollection._id } });
                console.log(`[MIGRATION] historical settings attached to the default collection (theme/modules preserved).`);
            }
        }

        // `sort_title` is derived at write time, so every item that predates the field has
        // none and would sort as an empty string, ahead of the whole collection. Each item
        // gets its own value, written as stored like the `kind` backfill above. Idempotent,
        // it only looks at items where the field is missing.
        const staleTitles = await db.items.find(missing('sort_title'), { fields: ['title'] });
        if (staleTitles.length > 0) {
            await db.items.updateEach(staleTitles.map((doc: any) => ({
                id: doc._id,
                patch: { set: { sort_title: buildSortTitle(doc.title) } }
            })));
            console.log(`[MIGRATION] sort_title computed for ${staleTitles.length} item(s).`);
        }

        // Until 3.1.2 an edit was written past the rules of the item's type. The form posts
        // every value as a string and an item of no type knows nothing of `tmdb_id` or
        // `discogs_id`, so one save was enough to store "1396" instead of
        // 1396. Nothing looked broken: the item still displayed, but every lookup
        // comparing the id as a number missed it, starting with duplicate detection, and
        // the same record could be added a second time. The write path is fixed; this
        // repairs what it left behind.
        //
        // Only fields a plugin declares as numbers are touched. `hardcover_slug` (books)
        // and `set_num` (LEGO) are external ids too and are legitimately strings.
        for (const plugin of registry.getAll()) {
            const field = plugin.externalIdField;
            if (!field) continue;

            const isNumeric = plugin.storedFields?.[field]?.type === 'number';
            if (!isNumeric) continue;

            const broken = await db.items.find(and(eq('kind', plugin.kind), ofType(field, 'text')), { fields: [field] });

            // A value that is not a number at all is left alone rather than turned into
            // NaN: it would be no more findable, and the original would be gone.
            const ops = broken
                .filter((doc: any) => /^\d+$/.test(String(doc[field]).trim()))
                .map((doc: any) => ({ id: doc._id, patch: { set: { [field]: parseInt(String(doc[field]), 10) } } }));

            if (ops.length > 0) {
                await db.items.updateEach(ops);
                console.log(`[MIGRATION] ${ops.length} ${plugin.kind} item(s) had their ${field} stored as text, now numeric.`);
            }
            if (broken.length > ops.length) {
                console.warn(`[MIGRATION] ${broken.length - ops.length} ${plugin.kind} item(s) hold a non-numeric ${field}; left untouched.`);
            }
        }

        // TMDB ids are shared across media types (e.g. movie 155 vs show 155), so Dvd
        // items are scoped by media_type ('movie' | 'tv'). Backfill legacy Dvd items
        // missing media_type with the schema default ('movie') so duplicate detection
        // and TMDB linking find them reliably. Idempotent.
        const missingMediaType = await db.items.updateMany(
            and(eq('kind', 'Dvd'), missing('media_type')),
            { set: { media_type: 'movie' } },
            { asStored: true }
        );
        if (missingMediaType.modified > 0) {
            console.log(`[MIGRATION] ${missingMediaType.modified} Dvd item(s) backfilled with media_type "movie".`);
        }

        // An item used to carry its provider id on a typed path of its own (discogs_id,
        // igdb_id, set_num...) and nothing saying which database handed that id out. There
        // was only ever one per plugin, so it never needed saying. Now that a plugin can
        // search several, an id alone no longer identifies anything: two databases number
        // unrelated records the same way.
        //
        // Everything already saved is attributed to the plugin's first declared source able
        // to describe a record, which is the one that historically filled that field. The typed path is left
        // exactly as it is: it is what the price estimates, the duplicate lookups and the
        // external links have always read.
        //
        // The `source` name predates the pair, though: books stored where an entry came
        // from under it (hardcover, goodreads, manual). The core always writes `source`
        // together with `source_id`, so a value naming none of the plugin's sources and
        // never paired with an id is that older meaning, not a reference. It is cleared,
        // which hands the item to the attribution like any other. Only for plugins written
        // for sources: one still declaring a bare searchProvider keeps whatever it stores.
        for (const plugin of registry.getAll()) {
            if (!plugin.sources || plugin.sources.length === 0) continue;
            const declared = plugin.sources.map(s => s.id);
            const cleared = await db.items.updateMany(
                and(
                    eq('kind', plugin.kind),
                    notIn('source', ['', null, ...declared]),
                    or(missing('source_id'), isIn('source_id', ['', null]))
                ),
                { set: { source: '' } },
                { asStored: true }
            );
            if (cleared.modified > 0) {
                console.log(`[MIGRATION] ${cleared.modified} ${plugin.kind} item(s) held a "source" naming none of the plugin's sources; cleared.`);
            }
        }

        for (const plugin of registry.getAll()) {
            const source = legacySource(plugin);
            const field = legacyIdFieldFor(plugin, source);
            if (!field || !source) continue;

            const unattributed = await db.items.find(
                and(eq('kind', plugin.kind), notIn(field, [null, '']), or(missing('source'), eq('source', ''))),
                { fields: [field] }
            );

            await db.items.updateEach(unattributed.map((doc: any) => ({
                id: doc._id,
                patch: { set: { source: source.id, source_id: String(doc[field]) } }
            })));

            if (unattributed.length > 0) {
                console.log(`[MIGRATION] ${unattributed.length} ${plugin.kind} item(s) attributed to source "${source.id}".`);
            }
        }

        // Where an item is kept used to be free text and nothing else. The shelf view
        // needs those places to exist as things of their own, so each collection's
        // distinct `location` values become the cells of a piece of furniture.
        //
        // Nothing is invented and nothing is lost: an item keeps carrying its shelf's
        // name in `location`, which is what leaves the location filter, the CSV
        // mapping, the exports and the backups working untouched.
        const collectionsToSeed = await db.collections.find(ne('shelvesSeeded', true), { fields: ['_id', 'name'] });
        for (const coll of collectionsToSeed) {
            // One collection at a time: a failure here leaves that collection unmarked, to
            // be tried again on the next boot, without holding back the others.
            let seeded;
            try {
                seeded = await seedFurnitureFromLocations(coll._id, coll.name);
            } catch (err) {
                console.error(`[MIGRATION] Shelves could not be seeded for collection "${coll.name}":`, err);
                continue;
            }

            // Marked even when the collection had no location at all: this converts what
            // the free-text era left behind, once. Shelves created from now on come from
            // the shelf editor, not from here.
            await db.collections.updateOne(eq('_id', idOf(coll._id)), { set: { shelvesSeeded: true } });

            if (seeded.shelves > 0 || seeded.renamed > 0 || seeded.blanked > 0) {
                console.log(`[MIGRATION] ${seeded.shelves} shelf/shelves seeded for collection "${coll.name}"` +
                    (seeded.renamed > 0 ? `, ${seeded.renamed} item(s) moved onto a merged spelling` : '') +
                    (seeded.blanked > 0 ? `, ${seeded.blanked} blank location(s) cleared` : '') + '.');
            }
        }

    } catch (error) {
        console.error('[MIGRATION] ERROR :', error);
    }
};
