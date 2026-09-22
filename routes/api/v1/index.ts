import { Router } from 'express';
import authRoutes from './authRoutes';
import collectionsRoutes from './collectionsRoutes';

const router = Router();

router.use(authRoutes);
router.use(collectionsRoutes);

export = router;
