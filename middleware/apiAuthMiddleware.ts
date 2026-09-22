import mongoose from 'mongoose';
import { resolveMemberRole, roleAtLeast } from '../utils/collectionHelpers';

/**
 * Stateless per-request counterpart to requireCollectionRole: checks req.user's role
 * against the collection named by req.params[idParam] directly, instead of
 * res.locals.collectionRole (which middleware/collectionMiddleware.ts only ever
 * computes for the session's single "active" collection - meaningless here, since
 * every /api/v1 call names its own collectionId explicitly). On success, attaches
 * req.apiCollection and req.apiCollectionRole for the route handler to reuse (e.g.
 * for visibility filtering, which needs to know if THIS collection's role is admin -
 * not whatever collection happens to be active in the user's web session).
 */
/**
 * Stateless counterpart to requireAdmin (middleware/authMiddleware.ts), which reads
 * res.locals.user - never populated for an API request. Instance-admin-only actions
 * (create/delete a collection, user management, IP blocking, login logs, instance
 * settings) check req.user.isAdmin directly instead.
 */
export const requireApiAdmin = (req: any, res: any, next: any) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
};

export const requireApiCollectionRole = (minRole: 'viewer' | 'editor' | 'admin', idParam: string = 'id') => {
  return async (req: any, res: any, next: any) => {
    const collectionId = req.params[idParam];
    if (!mongoose.Types.ObjectId.isValid(collectionId)) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    const { collection, role } = await resolveMemberRole(req.user, collectionId);
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    if (!roleAtLeast(role, minRole)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    req.apiCollection = collection;
    req.apiCollectionRole = role;
    next();
  };
};
