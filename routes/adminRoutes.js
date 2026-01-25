const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/User');
const BlockedIP = require('../models/blockedIP');
const LoginLog = require('../models/LoginLog');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

/**
 * routes/adminRoutes.js
 *
 * Administration routes: user management, IP blocking and login logs.
 */

/**
 * Generate a random password.
 * @param {number} [length=12]
 * @returns {string}
 */
const createPassword = (length = 12) => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
};

/**
 * Helper to load the common admin data used by the dashboard view.
 * Centralizing this avoids duplicating queries across handlers.
 */
async function loadAdminData() {
    const users = await User.find().sort({ lastChange: -1 });
    const blockedIps = await BlockedIP.find().sort({ createdAt: -1 });
    const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(20);
    return { users, blockedIps, logs };
}

// DASHBOARD (GET)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await loadAdminData();

        // Read optional message key from query and translate in the view.
        const msgKey = req.query.msg;

        res.render('admin', {
            ...data,
            user: res.locals.user,
            successMessage: msgKey ? req.t(`messages.${msgKey}`) : null,
            newPassword: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Add user (POST)
router.post('/add-user', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, email } = req.body;
        const password = createPassword();
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user then force-update the stored password hash.
        const newUser = await User.create({
            username,
            email,
            password: password,
            lastChange: new Date()
        });

        await User.updateOne(
            { _id: newUser._id },
            { $set: { password: hashedPassword } }
        );

        // Reload admin data (including logs) for the rendered view.
        const data = await loadAdminData();

        res.render('admin', {
            ...data,
            user: res.locals.user,
            successMessage: `Utilisateur ${username} créé !`,
            newPassword: password
        });

    } catch (err) {
        console.error("Creation error:", err);
        res.redirect('/admin?msg=user_created');
    }
});

// Reset password (POST)
router.post('/reset-password', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        const userToUpdate = await User.findById(userId);

        if (userToUpdate) {
            const password = createPassword();
            const hashedPassword = await bcrypt.hash(password, 10);

            await User.updateOne(
                { _id: userId },
                { $set: { password: hashedPassword, lastChange: new Date() } }
            );

            // Reload data for the view after change.
            const data = await loadAdminData();

            res.render('admin', {
                ...data,
                user: res.locals.user,
                successMessage: req.t('messages.password_reset_success', { name: userToUpdate.username }),
                newPassword: password
            });
        } else {
            res.redirect('/admin');
        }
    } catch (err) {
        console.error(err);
        res.redirect('/admin');
    }
});

// 4. Simple actions (redirects)
// These handlers redirect back to the admin root and therefore do not
// need to reload the logs.
router.post('/delete-user', requireAuth, requireAdmin, async (req, res) => {
    try {
        if (req.body.userId === res.locals.user._id.toString()) return res.redirect('/admin?msg=delete_self_error');
        await User.findByIdAndDelete(req.body.userId);
        res.redirect('/admin?msg=user_deleted');
    } catch (err) { res.redirect('/admin'); }
});

router.post('/block-ip', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { ipAddress } = req.body;
        const exists = await BlockedIP.findOne({ ip: ipAddress });
        if (!exists) await BlockedIP.create({ ip: ipAddress });
        res.redirect('/admin?msg=ip_blocked');
    } catch (err) { res.redirect('/admin'); }
});

router.post('/unblock-ip', requireAuth, requireAdmin, async (req, res) => {
    try {
        await BlockedIP.findByIdAndDelete(req.body.ipId);
        res.redirect('/admin?msg=ip_unblocked');
    } catch (err) { res.redirect('/admin'); }
});

module.exports = router;