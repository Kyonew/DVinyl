import { Router } from 'express';
import * as oidcController from '../controllers/oidcController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Mounted only when isOidcEnabled() (see app.ts).
router.get('/login/oidc', oidcController.login_oidc_get);
router.get('/login/oidc/callback', oidcController.oidc_callback_get);
router.get('/settings/oidc/link', requireAuth, oidcController.link_oidc_get);

export = router;
