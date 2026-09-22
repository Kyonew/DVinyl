import { Router } from 'express';
import authRoutes from './authRoutes';
import collectionsRoutes from './collectionsRoutes';
import itemsRoutes from './itemsRoutes';
import pluginsRoutes from './pluginsRoutes';

const router = Router();

router.use(authRoutes);
router.use(collectionsRoutes);
router.use(itemsRoutes);
router.use(pluginsRoutes);

export = router;
