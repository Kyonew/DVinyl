import InstanceSettings from '../models/InstanceSettings';
import Collection from '../models/Collection';

/**
 * In-memory cache of the singleton document. collectionMiddleware consults the
 * instance settings on every authenticated request, so hitting Mongo each time
 * would be wasteful for a document that changes once in a blue moon.
 * Invalidated by saveInstanceSettings() and by the backup restore.
 */
let cached: any = null;

export interface InstanceSettingsData {
    allowMemberCollectionCreation: boolean;
    maxCollectionsPerUser: number;
}

/** Drops the cache; call after any out-of-band write (restore, direct update). */
export function invalidateInstanceSettingsCache(): void {
    cached = null;
}

/**
 * Returns the singleton settings, creating it with schema defaults on first use.
 * Never throws: on a DB hiccup it falls back to the restrictive defaults rather
 * than breaking every request that goes through collectionMiddleware.
 */
export async function getInstanceSettings(): Promise<InstanceSettingsData> {
    if (cached) return cached;

    try {
        const doc: any = await InstanceSettings.findOneAndUpdate(
            { key: 'instance' },
            { $setOnInsert: { key: 'instance' } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        cached = {
            allowMemberCollectionCreation: !!doc?.allowMemberCollectionCreation,
            maxCollectionsPerUser: doc?.maxCollectionsPerUser || 1
        };
        return cached;
    } catch (err) {
        console.error('[ERR] getInstanceSettings:', err);
        return { allowMemberCollectionCreation: false, maxCollectionsPerUser: 1 };
    }
}

/** Persists the instance settings and refreshes the cache. */
export async function saveInstanceSettings(values: Partial<InstanceSettingsData>): Promise<void> {
    await InstanceSettings.updateOne(
        { key: 'instance' },
        { $set: values },
        { upsert: true }
    );
    invalidateInstanceSettingsCache();
}

/**
 * Whether `user` may create one more collection right now, and why not otherwise.
 * Instance admins always may (and are exempt from the quota); everyone else needs
 * the instance toggle on and must be under maxCollectionsPerUser, counted on the
 * collections they OWN (createdBy) - collections merely shared with them don't count.
 */
export async function checkCollectionCreation(user: any): Promise<'ok' | 'forbidden' | 'quota'> {
    if (!user) return 'forbidden';
    if (user.isAdmin) return 'ok';

    const settings = await getInstanceSettings();
    if (!settings.allowMemberCollectionCreation) return 'forbidden';

    const owned = await Collection.countDocuments({ createdBy: user._id });
    return owned < settings.maxCollectionsPerUser ? 'ok' : 'quota';
}

/** Boolean shorthand of checkCollectionCreation(), for the UI gating. */
export async function canUserCreateCollection(user: any): Promise<boolean> {
    return (await checkCollectionCreation(user)) === 'ok';
}
