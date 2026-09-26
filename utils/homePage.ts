import Collection from '../models/Collection';
import { sessionActiveCollectionId, setActiveCollection } from './collectionHelpers';

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
 * The path a user should land on when they open the app. Bare, with no view pinned to
 * it: the collection page reads `homeView` itself, so the default view applies whether
 * the user got there by opening the app or by clicking Collection in the nav.
 */
export function homePathFor(user: any): string {
    const page: HomePage = isHomePage(user?.homePage) ? user.homePage : 'dashboard';
    return PATH_BY_PAGE[page];
}

/**
 * Moves this session into the user's chosen home collection, if they still belong to it.
 * Called when the app is opened (once per session, see the landing route) and when the
 * choice is made, so it visibly takes effect. Nowhere else: the switcher has to stay
 * free to take the user anywhere for as long as they keep browsing.
 *
 * Never throws: a home that cannot be resolved leaves the user wherever they already
 * were, which is the same thing an unset preference does.
 */
export async function applyHomeCollection(req: any, homeCollectionId: any = req.user?.homeCollectionId): Promise<void> {
    if (!homeCollectionId) return;
    if (String(sessionActiveCollectionId(req)) === String(homeCollectionId)) return;

    try {
        const home = await Collection.findOne({
            _id: homeCollectionId,
            'members.user': req.user._id
        }).select('_id');
        if (!home) return;

        await setActiveCollection(req, home._id);
    } catch (err) {
        console.error('[HOME] Could not apply the home collection:', err);
    }
}
