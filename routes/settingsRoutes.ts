import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../core/db';
import { and, eq, idOf, isId } from '../core/db/query';
import { requireAuth } from '../middleware/authMiddleware';
import { usernameTaken } from '../core/accounts';
import { SUPPORTED_CURRENCIES } from '../config/constants';
import { viewRegistry } from '../core/viewRegistry';
import { applyHomeCollection, HOME_PAGES, isHomePage } from '../utils/homePage';

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
    res.render('settings', {
        user: res.locals.user,
        homePages: HOME_PAGES,
        currencies: SUPPORTED_CURRENCIES,
        // Every registered view, not the ones available on this page: the selector is
        // about a page the user is not on, and a combination that does not apply (the
        // shelf on a wishlist) resolves back to the grid when they get there.
        collectionViews: viewRegistry.getAll()
    });
});

// Check whether a username is available
router.post('/check-username', requireAuth, async (req, res) => {
    const { username } = req.body;
    try {
        // If user checks their current username, consider it available
        if (username === res.locals.user.username) {
            return res.json({ success: true, message: req.t('messages.username_current') });
        }

        if (await usernameTaken(username, res.locals.user._id)) {
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
        if (await usernameTaken(username, res.locals.user._id)) {
            return res.status(400).json({ success: false, message: req.t('errors.username_taken') });
        }
        await db.users.updateOne(eq('_id', idOf(res.locals.user._id)), { set: { username: username } });
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
        const currentUser = await db.users.findById(idOf(userId), { defaults: true });
        removeAvatarFile(currentUser?.img);

        // Update DB with new path
        const newAvatarPath = `/uploads/avatars/${req.file.filename}`;
        await db.users.updateOne(eq('_id', idOf(userId)), { set: { img: newAvatarPath } });

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
        const currentUser = await db.users.findById(idOf(userId), { defaults: true });
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
        await db.users.updateOne(eq('_id', idOf(userId)), { set: { img: newAvatarPath } });

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
        const currentUser = await db.users.findById(idOf(userId), { defaults: true });
        removeAvatarFile(currentUser?.img);

        await db.users.updateOne(eq('_id', idOf(userId)), { set: { img: DEFAULT_AVATAR } });

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
        const user = await db.users.findById(idOf(res.locals.user._id), { defaults: true });
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
        await db.users.updateOne(eq('_id', idOf(res.locals.user._id)), { set: {
            password: hashedPassword,
            lastChange: Date.now()
        } });

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
        await db.users.updateOne(eq('_id', idOf(res.locals.user._id)), { set: { theme: theme } });
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
        await db.users.updateOne(eq('_id', idOf(userId)), { set: { language } });

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

// Update where opening the app lands: which collection, which page, and the view that
// page opens in. One form, so a partial submission never leaves half a preference set.
router.post('/update-home', requireAuth, async (req: any, res) => {
    const { homePage, homeView } = req.body;
    const userId = res.locals.user._id;

    try {
        // An empty value means "wherever I left off". Anything else has to be a
        // collection this user actually belongs to, or they would be sent, every launch,
        // to a collection the middleware immediately has to heal away from.
        let homeCollectionId = null;
        if (req.body.homeCollectionId) {
            const member = isId(req.body.homeCollectionId)
                ? await db.collections.findOne(and(eq('_id', req.body.homeCollectionId), eq('members.user', idOf(userId))), { fields: ['_id'] })
                : null;
            if (!member) {
                return res.redirect('/settings');
            }
            homeCollectionId = member._id;
        }

        await db.users.updateOne(eq('_id', idOf(userId)), { set: {
            homeCollectionId,
            homePage: isHomePage(homePage) ? homePage : 'dashboard',
            homeView: viewRegistry.get(homeView) ? homeView : ''
        } });

        // Move there now instead of waiting for the next launch: picking a home
        // collection and watching the header keep the old one reads as a setting that
        // did not save.
        await applyHomeCollection(req, homeCollectionId);

        res.redirect('/settings');
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Unlink the currently linked SSO (OIDC) identity, if any.
router.post('/oidc/unlink', requireAuth, async (req, res) => {
    try {
        await db.users.updateOne(eq('_id', idOf(res.locals.user._id)), { unset: ['oidc'] });
        res.json({ success: true, message: req.t('messages.oidc_unlinked') });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

router.post('/update-currency', requireAuth, async (req, res) => {
    const { currency } = req.body;
    const userId = res.locals.user._id;

    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
        return res.status(400).send(req.t('errors.unsupported_currency'));
    }

    try {
        await db.users.updateOne(eq('_id', idOf(userId)), { set: { currency } });
        res.redirect('/settings');
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

export = router;