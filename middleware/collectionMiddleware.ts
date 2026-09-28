import Collection from '../models/Collection';
import User from '../models/User';
import { resolveActiveCollectionForUser, sessionActiveCollectionId } from '../utils/collectionHelpers';
import { canUserCreateCollection } from '../utils/instanceSettings';

/**
 * Resolves the current user's active collection and exposes it to routes/views:
 *   - res.locals.activeCollectionId : ObjectId used to scope read queries
 *   - res.locals.activeCollection   : the active collection document
 *   - res.locals.userCollections    : {name, slug} of every collection the user belongs to
 *   - res.locals.collectionRole     : 'admin' | 'editor' | 'viewer' | null for the active collection
 *   - res.locals.isCollectionAdmin  : role === 'admin' (instance admins always qualify)
 *   - res.locals.canEditCollection  : role is admin or editor (drives mutation UI/routes)
 *   - res.locals.canCreateCollection: instance admin, or the instance allows it and the
 *                                     user is under their quota (drives the "new collection" UI)
 *   - req.activeCollectionId        : same id, for route handlers
 *   - res.locals.isShareView        : true when access comes from one of a collection's
 *                                     public share links (see routes/shareRoutes.ts)
 *                                     rather than a real signed-in member
 *   - res.locals.shareScope         : that link's scope (see models/Collection.ts
 *                                     `shareLinks`) - empty array means the whole
 *                                     collection; only meaningful when isShareView
 *
 * The active collection belongs to the browser session (see setActiveCollection), so
 * each device browses its own. The user's lastActiveCollectionId seeds a session that
 * has not chosen yet. Self-heals: if both are stale/missing, it resolves a valid one and
 * persists it back. For anonymous requests, falls back to a share-link
 * cookie if present; otherwise no-ops.
 */
async function collectionMiddleware(req: any, res: any, next: any) {
    res.locals.activeCollectionId = null;
    res.locals.activeCollection = null;
    res.locals.userCollections = [];
    res.locals.collectionRole = null;
    res.locals.isCollectionAdmin = false;
    res.locals.canEditCollection = false;
    res.locals.canCreateCollection = false;
    res.locals.isShareView = false;
    res.locals.shareScope = [];

    if (!req.user) {
        // No session at all: the only other way in is one of a collection's public
        // share links. Skip the lookup entirely when the cookie is absent, so ordinary
        // anonymous traffic (the login page, static-ish routes) costs no extra query.
        const shareToken = req.cookies?.dv_share;
        if (shareToken) {
            try {
                const shared = await Collection.findOne({
                    shareLinks: { $elemMatch: { token: shareToken, enabled: true } }
                });
                const link = shared?.shareLinks.find((l: any) => l.token === shareToken);
                if (shared && link) {
                    res.locals.activeCollectionId = shared._id;
                    res.locals.activeCollection = shared;
                    res.locals.collectionRole = 'viewer';
                    res.locals.isCollectionAdmin = false;
                    res.locals.canEditCollection = false;
                    res.locals.isShareView = true;
                    res.locals.shareScope = link.scope || [];
                    req.activeCollectionId = shared._id;
                }
            } catch (err) {
                console.error('[ERR] CollectionMiddleware (share):', err);
            }
        }
        return next();
    }

    try {
        // The session's own choice first, so each device stays on the collection it
        // switched to; the user's last collection only seeds a session that has none.
        const wanted = sessionActiveCollectionId(req) || req.user.lastActiveCollectionId;
        let active = wanted
            ? await Collection.findOne({
                _id: wanted,
                'members.user': req.user._id
            })
            : null;

        if (!active) {
            active = await resolveActiveCollectionForUser(req.user);

            // Self-heal the user's value only when it is the one that went stale. A
            // session that fell back is no reason to move the user's other devices.
            if (active && String(req.user.lastActiveCollectionId) !== String(active._id)) {
                await User.updateOne(
                    { _id: req.user._id },
                    { $set: { lastActiveCollectionId: active._id } }
                );
                req.user.lastActiveCollectionId = active._id;
            }
        }

        if (active) {
            if (req.session && String(sessionActiveCollectionId(req)) !== String(active._id)) {
                req.session.activeCollection = { user: String(req.user._id), collection: String(active._id) };
            }

            res.locals.activeCollectionId = active._id;
            res.locals.activeCollection = active;
            req.activeCollectionId = active._id;

            // Role on the active collection. Instance admins act as collection admins
            // everywhere; other users get their membership role (or stay null).
            if (req.user.isAdmin) {
                res.locals.collectionRole = 'admin';
            } else {
                const membership = (active.members || []).find(
                    (m: any) => String(m.user) === String(req.user._id)
                );
                res.locals.collectionRole = membership ? membership.role : null;
            }
            res.locals.isCollectionAdmin = res.locals.collectionRole === 'admin';
            res.locals.canEditCollection =
                res.locals.collectionRole === 'admin' || res.locals.collectionRole === 'editor';
        }

        res.locals.userCollections = await Collection
            .find({ 'members.user': req.user._id }, 'name slug')
            .lean();

        res.locals.canCreateCollection = await canUserCreateCollection(req.user);

        next();
    } catch (err) {
        console.error('[ERR] CollectionMiddleware:', err);
        next();
    }
}

export = collectionMiddleware;
