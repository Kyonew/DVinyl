import Collection from '../models/Collection';
import User from '../models/User';

/**
 * Turns arbitrary text into a URL-safe slug: lowercase, diacritics stripped,
 * non-alphanumeric runs collapsed to a single dash, edges trimmed.
 * Self-contained (no slugify dependency, and no existing slug precedent in the repo).
 */
export function slugify(text: string): string {
    return (text || '')
        .toString()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // strip diacritics (combining marks)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Builds a slug from `base` that no existing Collection already uses,
 * appending -2, -3, ... on collision. Falls back to 'collection' if base is empty.
 */
export async function generateUniqueSlug(base: string): Promise<string> {
    const root = slugify(base) || 'collection';
    let candidate = root;
    let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await Collection.findOne({ slug: candidate }).lean()) {
        n += 1;
        candidate = `${root}-${n}`;
    }
    return candidate;
}

/**
 * Returns the single default collection, creating it if missing.
 * The default collection is seeded around the historical admin (isAdmin === true).
 * Returns null only on a brand-new install with zero users (pre-/setup), where
 * there's nothing to own it yet - setupRoutes creates it explicitly at that point.
 */
export async function findOrCreateDefaultCollection(): Promise<any> {
    let collection = await Collection.findOne({ isDefault: true });
    if (collection) return collection;

    const admin: any = await User.findOne({ isAdmin: true }).select('_id');
    if (!admin) return null;

    collection = await Collection.create({
        name: 'Vinyl',
        slug: await generateUniqueSlug('Vinyl'),
        createdBy: admin._id,
        isDefault: true,
        members: [{ user: admin._id, role: 'admin' }]
    });
    return collection;
}

/**
 * Resolves the collection a user should currently be browsing (self-heal path,
 * used by collectionMiddleware when the persisted lastActiveCollectionId is stale
 * or missing). Order of preference:
 *   1. lastActiveCollectionId, if the user is still a member of it
 *   2. the first collection the user belongs to
 *   3. instance admins only: the default collection (creating it/membership if needed)
 * Non-admin users with zero memberships get null (empty app until an admin adds
 * them somewhere) - auto-joining the default collection would leak its content.
 */
export async function resolveActiveCollectionForUser(user: any): Promise<any> {
    if (!user) return null;

    if (user.lastActiveCollectionId) {
        const current = await Collection.findOne({
            _id: user.lastActiveCollectionId,
            'members.user': user._id
        });
        if (current) return current;
    }

    const membership = await Collection.findOne({ 'members.user': user._id });
    if (membership) return membership;

    if (!user.isAdmin) return null;

    const fallback = await findOrCreateDefaultCollection();
    if (!fallback) return null;

    const isMember = (fallback.members || []).some(
        (m: any) => String(m.user) === String(user._id)
    );
    if (!isMember) {
        await Collection.updateOne(
            { _id: fallback._id },
            { $addToSet: { members: { user: user._id, role: 'admin' } } }
        );
    }
    return fallback;
}
