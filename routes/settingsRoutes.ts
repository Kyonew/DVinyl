import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import User from '../models/User';
import { requireAuth } from '../middleware/authMiddleware';

const router = express.Router();

const AVATARS_DIR = path.join(__dirname, '../public/uploads/avatars');
const DEFAULT_AVATAR = '/ressources/no-pp.jpg';

// Removes a user's previously uploaded avatar file from disk, if any (never touches the default image).
const removeAvatarFile = (avatarPath?: string | null) => {
    if (!avatarPath || avatarPath.includes('no-pp.jpg')) return;
    const absolutePath = path.join(__dirname, '../public', avatarPath);
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
};

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
};

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
        const userId = (req as any).user ? (req as any).user._id : 'unknown'; // req.user is available via requireAuth
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
        removeAvatarFile(currentUser?.img);

        // Update DB with new path
        const newAvatarPath = `/uploads/avatars/${req.file.filename}`;
        await User.findByIdAndUpdate(userId, { img: newAvatarPath });

        res.json({ success: true, message: req.t('messages.avatar_updated'), avatarPath: newAvatarPath });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Import avatar from Gravatar (opt-in: only triggered by explicit user action, never automatically).
router.post('/import-gravatar', requireAuth, async (req, res) => {
    try {
        const userId = res.locals.user._id;
        const currentUser = await User.findById(userId);
        if (!currentUser) return res.status(404).json({ success: false, message: req.t('messages.generic_error') });

        const hash = crypto.createHash('sha256').update(currentUser.email.trim().toLowerCase()).digest('hex');
        const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?s=256&d=404`;

        const gravatarRes = await fetch(gravatarUrl);
        if (gravatarRes.status === 404) {
            return res.status(404).json({ success: false, message: req.t('messages.gravatar_not_found') });
        }
        if (!gravatarRes.ok) {
            return res.status(502).json({ success: false, message: req.t('messages.generic_error') });
        }

        const contentType = gravatarRes.headers.get('content-type') || 'image/jpeg';
        const ext = EXT_BY_CONTENT_TYPE[contentType] || '.jpg';
        const buffer = Buffer.from(await gravatarRes.arrayBuffer());

        if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
        const filename = `avatar-${userId}-${Date.now()}${ext}`;
        fs.writeFileSync(path.join(AVATARS_DIR, filename), buffer);

        removeAvatarFile(currentUser.img);

        const newAvatarPath = `/uploads/avatars/${filename}`;
        await User.findByIdAndUpdate(userId, { img: newAvatarPath });

        res.json({ success: true, message: req.t('messages.avatar_updated'), avatarPath: newAvatarPath });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Remove the current avatar and fall back to the default image.
router.post('/remove-avatar', requireAuth, async (req, res) => {
    try {
        const userId = res.locals.user._id;
        const currentUser = await User.findById(userId);
        removeAvatarFile(currentUser?.img);

        await User.findByIdAndUpdate(userId, { img: DEFAULT_AVATAR });

        res.json({ success: true, message: req.t('messages.avatar_updated'), avatarPath: DEFAULT_AVATAR });
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
        if (!user) {
            res.status(500).json({ success: false, message: "User not found" });
            return;
        }
        // SSO-only accounts (provisioned through the IdP) have no local password
        // to change; they authenticate exclusively through their provider.
        if (!user.password) {
            return res.status(400).json({ success: false, message: req.t('errors.sso_no_local_password') });
        }
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

// Unlink the currently linked SSO (OIDC) identity, if any.
router.post('/oidc/unlink', requireAuth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(res.locals.user._id, { $unset: { oidc: 1 } });
        res.json({ success: true, message: req.t('messages.oidc_unlinked') });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

router.post('/update-currency', requireAuth, async (req, res) => {
    const { currency } = req.body;
    const userId = res.locals.user._id;

    if (!['EUR', 'USD', 'GBP'].includes(currency)) {
        return res.status(400).send('Devise non supportée');
    }

    try {
        await User.findByIdAndUpdate(userId, { currency });
        res.redirect('/settings');
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

export = router;