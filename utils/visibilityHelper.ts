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

