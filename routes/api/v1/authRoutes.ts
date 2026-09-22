import { Router } from 'express';
import * as apiAuthController from '../../../controllers/apiAuthController';
import { requireApiAuth } from '../../../middleware/authMiddleware';

const router = Router();

router.post('/auth/login', apiAuthController.login);
router.get('/auth/me', requireApiAuth, apiAuthController.me);

export = router;
