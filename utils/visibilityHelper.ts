import Item from '../models/Item';
import { registry } from '../core/registry';

/**
 * Restricts a query to items whose kind belongs to a currently-enabled module.
 * Disabled-module items stay in the DB but disappear from every collection/dashboard/wishlist view.
 * Legacy music items (no `kind` field) are included only when the music module is enabled.
 */
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
export function applyContainedFilter(query: any): void {
    query.parent = { $exists: false };
}

export function applyEnabledModulesFilter(query: any, settings: any): void {
    const all = registry.getAll();
    const enabled = registry.getEnabled(settings);

    // Everything enabled → no restriction (legacy no-kind items remain visible)
    if (enabled.length === all.length) {
        return;
    }

    const ors: any[] = enabled.map(p => ({ kind: p.kind }));
    if (enabled.some(p => p.matchesLegacyItems)) {
        ors.push({ kind: { $exists: false } });
    }

    // Nothing enabled → match no item; otherwise require an enabled kind
    const condition = ors.length > 0 ? { $or: ors } : { _id: null };

    if (!query.$and) {
        query.$and = [];
    }
    query.$and.push(condition);
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
export function applyShareScopeFilter(query: any, shareScope: ShareScopeEntry[] | undefined | null): void {
    if (!shareScope || shareScope.length === 0) {
        return;
    }

    const ors: any[] = [];
    for (const entry of shareScope) {
        const plugin = registry.get(entry.pluginId);
        if (!plugin) continue; // plugin removed/renamed since the scope was saved

        const kindMatch = plugin.matchesLegacyItems
            ? { $or: [{ kind: plugin.kind }, { kind: { $exists: false } }] }
            : { kind: plugin.kind };

        // The format value lives under `format` for most plugins but under
        // `media_type` for music (legacy field name) - same convention the generic
        // format filter above (FORMAT FILTER) already checks both for. $and (not a
        // spread) because kindMatch is itself an `$or` for matchesLegacyItems plugins
        // (music) - spreading two `$or` keys into one object would silently drop one.
        ors.push(entry.formats && entry.formats.length > 0
            ? { $and: [kindMatch, { $or: [{ format: { $in: entry.formats } }, { media_type: { $in: entry.formats } }] }] }
            : kindMatch);
    }

    const condition = ors.length > 0 ? { $or: ors } : { _id: null };

    if (!query.$and) {
        query.$and = [];
    }
    query.$and.push(condition);
}

/**
 * Same rule as applyShareScopeFilter, asked about one item instead of a query: may the
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

    const judged = item.parent ? await Item.findById(item.parent).lean() as any : item;
    if (!judged) return false;

    const plugin = registry.getByKind(judged.kind);
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

export function applyVisibilityFilter(query: any, isAdmin: boolean, settings: AppSettings): void {
    if (!settings || !settings.visibility) {
        return;
    }

    const { applyToAdmin, hiddenItems, hiddenGenres, hiddenTypes } = settings.visibility;

    // Do not apply filter if user is admin and applyToAdmin is false
    if (isAdmin && !applyToAdmin) {
        return;
    }

    const conditions = [];

    if (hiddenItems && hiddenItems.length > 0) {
        conditions.push({ _id: { $nin: hiddenItems } });
    }

    if (hiddenGenres && hiddenGenres.length > 0) {
        conditions.push({ genre: { $nin: hiddenGenres } });
        conditions.push({ genres: { $nin: hiddenGenres } });
        // Since genres/styles can overlap, let's also filter styles just in case
        conditions.push({ styles: { $nin: hiddenGenres } });
    }

    if (hiddenTypes && hiddenTypes.length > 0) {
        conditions.push({ kind: { $nin: hiddenTypes } });
    }

    if (conditions.length > 0) {
        if (!query.$and) {
            query.$and = [];
        }
        query.$and.push(...conditions);
    }
}

