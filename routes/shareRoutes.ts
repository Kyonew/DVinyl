import { Router } from 'express';
import Collection from '../models/Collection';

/**
 * Public, account-free entry point for a collection's share link (see
 * routes/adminRoutes.ts for how the link/token is managed, and
 * middleware/collectionMiddleware.ts for how the resulting cookie grants
 * read-only access on every later request).
 */
const router = Router();

router.get('/share/:token', async (req: any, res: any) => {
  try {
    const collection = await Collection.findOne({
      shareLinks: { $elemMatch: { token: req.params.token, enabled: true } }
    }).select('_id').lean();

    if (!collection) {
      // Same response whether the token never existed or was disabled/regenerated,
      // so a stale link never reveals which case it is.
      return res.status(404).render('share-invalid');
    }

    // The token itself is the credential, re-validated against the live Collection
    // document on every request (collectionMiddleware), so it does not need to be
    // cryptographically signed - unlike it, this cookie only has to survive tampering
    // that a plain equality check on the DB row already catches.
    res.cookie('dv_share', req.params.token, {
      httpOnly: true,
      maxAge: 180 * 24 * 60 * 60 * 1000,
      secure: process.env.PROD === 'true',
      sameSite: 'lax'
    });

    res.redirect('/collection');
  } catch (err: any) {
    console.error('[ERR] Share link:', err.message);
    res.status(500).render('share-invalid');
  }
});

export = router;
