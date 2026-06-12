import { Router } from 'express';
import * as authController from '../controllers/authController';

const router = Router();

router.get('/login', authController.login_get);
router.post('/login', authController.login_post);
router.get('/logout', authController.logout_get);

export = router;