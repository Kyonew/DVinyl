import { registry } from '../core/registry';
import { db } from '../core/db';
import { all, and, eq, Filter, isIn, missing, none, notIn, or } from '../core/db/filter';
import { idOf } from '../core/db/ids';

/**
 * Keeps contained items out of a listing.
 *
 * An item can hold others: a TV show holds its seasons, each of which is a real item with
 * its own cover, year and episodes. Only the holder belongs on a shelf, the seasons are
 * reached from it, so every query that lists or counts what someone owns goes through
 * here. The item pages, the search by id and the exports deliberately do not: a contained
 * item is hidden from the grid, not from the app.
 *
 * Counting follows the same rule as showing, so the totals always match what is on screen:
 * a show with five seasons is one line and counts as one.
 */
export function notContainedFilter(): Filter {
    return missing('parent');
}

/**
 * The condition that matches the items belonging to one plugin.
 *
 * Items carry their plugin in `kind`, the Mongoose discriminator. The one exception is the
 * pre-plugins era, whose items have no `kind` at all: the boot migration backfills them,
 * but a dump restored on an older path can still hold some, so the plugin that claims that
 * legacy stock (`matchesLegacyItems`, music today) matches them too.
 */
export function pluginKindFilter(plugin: { kind: string; matchesLegacyItems?: boolean }): Filter {
    return plugin.matchesLegacyItems
        ? or(eq('kind', plugin.kind), missing('kind'))
        : eq('kind', plugin.kind);
}

/**
 * Restricts a listing to the items whose kind belongs to a module the collection has on.
 * Items of a module turned off stay stored but disappear from every collection, dashboard
 * and wishlist view. Items predating kinds count as the legacy-claiming plugin's.
 */
export function enabledModulesFilter(settings: any): Filter {
    const enabled = registry.getEnabled(settings);

    // Everything enabled: no restriction, so items of no known kind stay visible
    if (enabled.length === registry.getAll().length) {
        return all();
    }

    // Nothing enabled matches no item
    return or(...enabled.map(pluginKindFilter));
}

export interface ShareScopeEntry {
    pluginId: string;
    formats?: string[];
}

/**
 * Restricts a query to a collection share link's scope (see models/Collection.ts
 * `shareScope`). Only ever call this for an actual share view - a real member
 * browsing their own collection must never be scoped by it.
 * Empty/absent scope = whole collection, unrestricted (the default). A non-empty
 * scope allowlists only the listed plugin types, each optionally narrowed to
 * specific format values; an entry with no formats means every format of that type.
 * A scope that resolves to nothing valid (e.g. every selected plugin was since
 * removed) fails closed - matches no item - rather than falling back to "everything".
 */
export function shareScopeFilter(shareScope: ShareScopeEntry[] | undefined | null): Filter {
    if (!shareScope || shareScope.length === 0) {
        return all();
    }

    const branches: Filter[] = [];
    for (const entry of shareScope) {
        const plugin = registry.get(entry.pluginId);
        if (!plugin) continue; // plugin removed/renamed since the scope was saved

        // The format value lives under `format` for most plugins but under `media_type`
        // for music (legacy field name), the same convention the format filter of the
        // collection page checks both for.
        branches.push(entry.formats && entry.formats.length > 0
            ? and(pluginKindFilter(plugin), or(isIn('format', entry.formats), isIn('media_type', entry.formats)))
            : pluginKindFilter(plugin));
    }

    // A scope naming nothing that still exists fails closed
    return branches.length > 0 ? or(...branches) : none();
}

/**
 * Same rule as shareScopeFilter, asked about one item instead of a query: may the
 * current visitor see this one? Every page that serves a single item by its id goes
 * through here, otherwise a scoped link would give away what it excludes to anyone
 * willing to guess an id.
 *
 * A contained item is judged by what holds it. A season is only ever reached from its
 * show, and carries its own format: a link scoped to DVDs would turn the Blu-ray season
 * of a DVD box set into a dead end, on a page that links to it. What the link lets
 * through, it lets through whole.
 *
 * Always true outside a share view, and for a link that carries no scope: both mean
 * "the whole collection", which the collection membership check has already settled.
 */
export async function isWithinShareScope(res: any, item: any): Promise<boolean> {
    if (!res.locals.isShareView) return true;

    const shareScope: ShareScopeEntry[] = res.locals.shareScope || [];
    if (shareScope.length === 0) return true;
    if (!item) return false;

    const source = item.parent ? await db.items.findById(idOf(item.parent)) : item;
    if (!source) return false;

    // Through toObject(), because a document with no `kind` is hydrated against the base
    // schema, which declares neither `format` nor `media_type`: the getters come back empty
    // while the values are sat right there in the document. A lean read is already plain.
    const judged: any = typeof source.toObject === 'function' ? source.toObject() : source;

    // A pre-plugins item carries no `kind` at all. shareScopeFilter above lets it
    // through under the plugin that claims legacy items, so this has to agree: judged
    // otherwise, the grid would offer an item whose page then refuses to open.
    const plugin = judged.kind
        ? registry.getByKind(judged.kind)
        : registry.getAll().find(p => p.matchesLegacyItems);
    if (!plugin) return false;

    const entry = shareScope.find(s => s.pluginId === plugin.id);
    if (!entry) return false;
    if (!entry.formats || entry.formats.length === 0) return true;

    // Same legacy convention as the query filter above: music stores its format under
    // `media_type`, every other plugin under `format`.
    return entry.formats.includes(judged.format ?? judged.media_type);
}

interface VisibilitySettings {
    applyToAdmin: boolean;
    hiddenItems?: string[];
    hiddenGenres?: string[];
    hiddenTypes?: string[];
}

interface AppSettings {
    visibility?: VisibilitySettings
}

export function visibilityFilter(isAdmin: boolean, settings: AppSettings): Filter {
    if (!settings || !settings.visibility) {
        return all();
    }

    const { applyToAdmin, hiddenItems, hiddenGenres, hiddenTypes } = settings.visibility;

    // An admin sees everything unless the rules are set to apply to admins too
    if (isAdmin && !applyToAdmin) {
        return all();
    }

    const genres = hiddenGenres || [];
    return and(
        notIn('_id', (hiddenItems || []).map(idOf)),
        notIn('genre', genres),
        notIn('genres', genres),
        // Genres and styles overlap, so a hidden genre hides the items styled with it too
        notIn('styles', genres),
        notIn('kind', hiddenTypes || [])
    );
}


/**
 * What a shelf listing may show: one collection's owned items or wishlist, minus what the
 * visibility rules hide from this viewer, the types switched off and contained items, and
 * narrowed to the link's scope for a share visitor. Every page listing or counting what a
 * collection holds starts from here, so their numbers agree with each other.
 */
export function shelfFilter(options: {
    collectionId: any;
    inWishlist: boolean;
    isAdmin: boolean;
    settings: any;
    shareScope?: ShareScopeEntry[] | null;
}): Filter {
    return and(
        eq('collection', idOf(options.collectionId)),
        eq('in_wishlist', options.inWishlist),
        visibilityFilter(options.isAdmin, options.settings),
        enabledModulesFilter(options.settings),
        notContainedFilter(),
        options.shareScope ? shareScopeFilter(options.shareScope) : all()
    );
}
