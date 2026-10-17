import express from 'express';
import { requireAuth } from '../../middleware/authMiddleware';

const router = express.Router();

// The account page: what the avatar menu holds on desktop (collections, administration,
// appearance, settings, logout), laid out as a page for the phone's Account tab. Every
// value it shows is already in res.locals (authMiddleware, collectionMiddleware).
router.get('/account', requireAuth, (req: any, res: any) => {
  res.render('account', { user: res.locals.user });
});

export default router;
