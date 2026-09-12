import Collection from '../models/Collection';
import User from '../models/User';

// The pages a user may land on, in the order the settings selector offers them.
export const HOME_PAGES = ['dashboard', 'collection', 'wishlist'] as const;

export type HomePage = typeof HOME_PAGES[number];

const PATH_BY_PAGE: Record<HomePage, string> = {
    // Its own path rather than '/', which is the redirector that brought us here.
    dashboard: '/dashboard',
    collection: '/collection',
    wishlist: '/wishlist'
};

export function isHomePage(value: unknown): value is HomePage {
    return typeof value === 'string' && (HOME_PAGES as readonly string[]).includes(value);
}

/**
 * The path a user should land on when they open the app. The view is carried as a
 * query parameter rather than stored per browser, because the collection page already
 * resolves `?view=` through the registry: an id that no longer exists, or one that does
 * not apply to the page (the shelf on a wishlist), falls back to the grid on its own.
 */
export function homePathFor(user: any): string {
    const page: HomePage = isHomePage(user?.homePage) ? user.homePage : 'dashboard';
    const path = PATH_BY_PAGE[page];
    if (page === 'dashboard' || !user?.homeView) return path;
    return `${path}?view=${encodeURIComponent(user.homeView)}`;
}

/**
 * Moves the user into their chosen home collection, if they still belong to it.
 * Called when the app is opened (once per session, see the landing route) and when the
 * choice is made, so it visibly takes effect. Nowhere else: the switcher has to stay
 * free to take the user anywhere for as long as they keep browsing.
 *
 * Never throws: a home that cannot be resolved leaves the user wherever they already
 * were, which is the same thing an unset preference does.
 */
export async function applyHomeCollection(user: any): Promise<void> {
    if (!user?.homeCollectionId) return;
    if (String(user.lastActiveCollectionId) === String(user.homeCollectionId)) return;

    try {
        const home = await Collection.findOne({
            _id: user.homeCollectionId,
            'members.user': user._id
        }).select('_id');
        if (!home) return;

        await User.updateOne(
            { _id: user._id },
            { $set: { lastActiveCollectionId: home._id } }
        );
        user.lastActiveCollectionId = home._id;
    } catch (err) {
        console.error('[HOME] Could not apply the home collection:', err);
    }
}
