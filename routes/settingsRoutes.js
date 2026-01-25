const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { requireAuth } = require('../middleware/authMiddleware');

/**
 * routes/settingsRoutes.js
 *
 * User settings routes: avatar upload, username/theme/language updates
 * and password changes. Uses Multer for avatar uploads with local storage.
 */

// Multer configuration (image uploads)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
        // Keep a timestamp to avoid browser cache and include user ID for clarity
        const ext = path.extname(file.originalname);
        const userId = req.user ? req.user._id : 'unknown'; // req.user is available via requireAuth
        cb(null, `avatar-${userId}-${Date.now()}${ext}`);
  }
});

// Note: Multer runs before route handlers so accessing res.locals.user can be tricky.
// We include the user id in the filename (or use a wrapper) to associate uploads.
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Format non supporté (JPG, PNG, GIF, WEBP uniquement).'));
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});


// Routes

// Render settings page
router.get('/', requireAuth, (req, res) => {
    res.render('settings', { user: res.locals.user });
});

// Check whether a username is available
router.post('/check-username', requireAuth, async (req, res) => {
    const { username } = req.body;
    try {
        // If user checks their current username, consider it available
        if (username === res.locals.user.username) {
            return res.json({ success: true, message: req.t('messages.username_current') });
        }

        const userExists = await User.findOne({ username: username });
        if (userExists) {
            return res.status(400).json({ success: false, message: req.t('errors.username_taken') });
        }
        res.json({ success: true, message: req.t('messages.username_available') });
    } catch (error) {
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update username
router.post('/update-username', requireAuth, async (req, res) => {
    const { username } = req.body;
    try {
        const userExists = await User.findOne({ username: username });
        if (userExists && userExists._id.toString() !== res.locals.user._id.toString()) {
            return res.status(400).json({ success: false, message: req.t('errors.username_taken') });
        }
        await User.findByIdAndUpdate(res.locals.user._id, { username: username });
        res.redirect('/settings');
    } catch (error) {
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Upload avatar
router.post('/upload-avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    // Multer error handling
    if (!req.file) return res.status(400).json({ success: false, message: req.t('messages.avatar_upload_error') });

    try {
        const userId = res.locals.user._id;

        // Retrieve previous avatar to remove it from disk
        const currentUser = await User.findById(userId);
        const oldAvatarPath = currentUser.img; // e.g. "/uploads/avatars/avatar-123.jpg"

        // Remove old file from disk if not the default image
        if (oldAvatarPath && !oldAvatarPath.includes('no-pp.jpg')) {
            const absoluteOldPath = path.join(__dirname, '../public', oldAvatarPath);

            if (fs.existsSync(absoluteOldPath)) {
                fs.unlinkSync(absoluteOldPath);
                console.log(`🗑️ Removed old avatar: ${absoluteOldPath}`);
            }
        }

        // Update DB with new path
        const newAvatarPath = `/uploads/avatars/${req.file.filename}`;
        await User.findByIdAndUpdate(userId, { img: newAvatarPath });

        res.json({ success: true, message: req.t('messages.avatar_updated'), avatarPath: newAvatarPath });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update Password
router.post('/update-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        // Verify current password
        const user = await User.findById(res.locals.user._id);
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: req.t('errors.current_password_incorrect') });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(res.locals.user._id, { 
            password: hashedPassword, 
            lastChange: Date.now() 
        });
        
        res.json({ success: true, message: req.t('messages.password_updated') });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update Theme
router.post('/update-theme', requireAuth, async (req, res) => {
    const { theme } = req.body;
    
    if (!['light', 'dark'].includes(theme)) {
        return res.status(400).json({ success: false, message: req.t('errors.invalid_theme') });
    }

    try {
        await User.findByIdAndUpdate(res.locals.user._id, { theme: theme });
        res.json({ success: true, message: req.t('messages.theme_updated') });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update Language
router.post('/update-language', requireAuth, async (req, res) => {
  const { language } = req.body;
  const userId = res.locals.user._id;

  try {
    // Update language in DB
    await User.findByIdAndUpdate(userId, { language });

    // Update i18n language for current session
    await req.i18n.changeLanguage(language);

    // Redirect back or to settings page
    const backURL = req.header('Referer') || '/settings';
    res.redirect(backURL);

  } catch (err) {
    console.error(err);
    res.status(500).send(req.t('errors.lang_change_error'));
  }
});


module.exports = router;