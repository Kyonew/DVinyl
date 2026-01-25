/**
 * routes/authRoutes.js
 *
 * Authentication routes: render login page, handle login POST and logout.
 */
const { Router } = require('express');
const authController = require('../controllers/authController');

const router = Router();

router.get('/login', authController.login_get);
router.post('/login', authController.login_post);
router.get('/logout', authController.logout_get);

module.exports = router;