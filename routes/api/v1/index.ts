import { Router } from 'express';
import authRoutes from './authRoutes';

const router = Router();

router.use(authRoutes);

export = router;
