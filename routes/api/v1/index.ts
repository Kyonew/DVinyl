import { Router } from 'express';
import accountRoutes from './accountRoutes';
import adminRoutes from './adminRoutes';
import authRoutes from './authRoutes';
import collectionsRoutes from './collectionsRoutes';
import itemsRoutes from './itemsRoutes';
import pluginsRoutes from './pluginsRoutes';

const router = Router();

router.use(accountRoutes);
router.use(adminRoutes);
router.use(authRoutes);
router.use(collectionsRoutes);
router.use(itemsRoutes);
router.use(pluginsRoutes);

router.use((err: any, req: any, res: any, next: any) => {
  console.error('[API] unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export = router;
