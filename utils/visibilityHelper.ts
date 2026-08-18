import { registry } from '../core/registry';

/**
 * Restricts a query to items whose kind belongs to a currently-enabled module.
 * Disabled-module items stay in the DB but disappear from every collection/dashboard/wishlist view.
 * Legacy music items (no `kind` field) are included only when the music module is enabled.
 */
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

