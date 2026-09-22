import { Router } from 'express';
import authRoutes from './authRoutes';
import collectionsRoutes from './collectionsRoutes';
import itemsRoutes from './itemsRoutes';

const router = Router();

router.use(authRoutes);
router.use(collectionsRoutes);
router.use(itemsRoutes);

export = router;
