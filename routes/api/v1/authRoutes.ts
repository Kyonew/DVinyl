import { Router } from 'express';
import * as apiAuthController from '../../../controllers/apiAuthController';
import { requireApiAuth } from '../../../middleware/authMiddleware';

const router = Router();

router.post('/auth/login', apiAuthController.login);
router.get('/auth/me', requireApiAuth, apiAuthController.me);
router.post('/auth/refresh', apiAuthController.refresh);
router.post('/auth/logout', apiAuthController.logout);

export = router;
