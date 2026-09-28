import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import User from '../../../models/User';
import RefreshToken from '../../../models/RefreshToken';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { secondsBlocked, recordFailure, clearAttempts } from '../../../controllers/loginAttempts';
import { isLocalLoginDisabled } from '../../../config/oidc';

const router = Router();

router.use('/account', requireApiAuth);

const AVATARS_DIR = path.join(__dirname, '../../../public/uploads/avatars');
const DEFAULT_AVATAR = '/ressources/no-pp.jpg';

const removeAvatarFile = (avatarPath?: string | null) => {
  if (!avatarPath || avatarPath.includes('no-pp.jpg')) return;
  const absolutePath = path.join(__dirname, '../../../public', avatarPath);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
};

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp'
};

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
    cb(null, AVATARS_DIR);
  },
  filename: (req, file, cb) => {
    // Derive the extension from the (fileFilter-validated) mimetype, never from the
    // attacker-controlled client filename: express.static picks Content-Type from the
    // extension under nosniff, so a spoofed name could otherwise be served as HTML.
    const ext = EXT_BY_CONTENT_TYPE[file.mimetype] || '.jpg';
    const userId = (req as any).user ? (req as any).user._id : 'unknown';
    cb(null, `avatar-${userId}-${Date.now()}${ext}`);
  }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported format (JPG, PNG, GIF, WEBP only)'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Multer reports its failures by calling back with an error; turn those into the JSON
// error envelope instead of letting Express' default HTML error page leak out.
const uploadAvatarMiddleware = (req: any, res: any, next: any) => {
  uploadAvatar.single('avatar')(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'File too large (max 5MB)' });
      }
      return res.status(400).json({ success: false, error: 'No file uploaded, or unsupported format' });
    }
    next();
  });
};

router.get('/account/username-available', async (req: any, res: any) => {
  try {
    const username = String(req.query.username || '');
    if (username === req.user.username) {
      return res.status(200).json({ available: true });
    }
    const exists = await User.findOne({ username });
    res.status(200).json({ available: !exists });
  } catch (err: any) {
    console.error('API username-available error:', err);
    res.status(500).json({ success: false, error: 'Failed to check username availability' });
  }
});

router.patch('/account', async (req: any, res: any) => {
  try {
    const { username, theme, language, currency } = req.body || {};
    const set: Record<string, any> = {};

    if (username !== undefined) {
      if (typeof username !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid username' });
      }
      const trimmed = username.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, error: 'username cannot be empty' });
      }
      const existing = await User.findOne({ username: trimmed });
      if (existing && String(existing._id) !== String(req.user._id)) {
        return res.status(409).json({ success: false, error: 'Username already taken' });
      }
      set.username = trimmed;
    }

    if (theme !== undefined) {
      if (!['light', 'dark'].includes(theme)) {
        return res.status(400).json({ success: false, error: 'Invalid theme' });
      }
      set.theme = theme;
    }

    if (language !== undefined) {
      if (!['fr', 'en', 'de', 'es', 'it'].includes(language)) {
        return res.status(400).json({ success: false, error: 'Invalid language' });
      }
      set.language = language;
    }

    if (currency !== undefined) {
      if (!['EUR', 'USD', 'GBP'].includes(currency)) {
        return res.status(400).json({ success: false, error: 'Unsupported currency' });
      }
      set.currency = currency;
    }

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    await User.findByIdAndUpdate(req.user._id, set, { runValidators: true, context: 'query' });
    const updated: any = await User.findById(req.user._id)
      .select('username theme language currency')
      .lean();
    res.status(200).json({ user: updated });
  } catch (err: any) {
    console.error('API account update error:', err);
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, error: 'Username already taken' });
    }
    res.status(500).json({ success: false, error: 'Failed to update account' });
  }
});

router.post('/account/password', async (req: any, res: any) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'newPassword must be at least 8 characters' });
    }
    if (currentPassword !== undefined && typeof currentPassword !== 'string') {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }

    const user: any = await User.findById(req.user._id);
    if (!user.password) {
      // SSO-only account (provisioned through the IdP) — no local password to change.
      return res.status(400).json({ success: false, error: 'This account has no local password (SSO-only)' });
    }

    const attemptKey = `pwchange:${req.user._id}`;
    const blockedFor = secondsBlocked(attemptKey);
    if (blockedFor) {
      return res.status(429).json({ success: false, error: 'Too many failed attempts. Try again later.' });
    }

    const isMatch = await bcrypt.compare(currentPassword || '', user.password);
    if (!isMatch) {
      const { justBlocked } = recordFailure(attemptKey);
      if (justBlocked) {
        return res.status(429).json({ success: false, error: 'Too many failed attempts. Try again later.' });
      }
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.user._id, { password: hashedPassword, lastChange: Date.now() });
    // Changing the password must also kill every refresh token: otherwise a token
    // stolen before the change keeps minting fresh access tokens afterwards.
    // The caller's own token is revoked too; the client re-logs in with the new password.
    await RefreshToken.deleteMany({ user: req.user._id });
    clearAttempts(attemptKey);
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API change password error:', err);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

router.post('/account/avatar', uploadAvatarMiddleware, async (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded, or unsupported format' });
  }
  try {
    const currentUser = await User.findById(req.user._id);
    removeAvatarFile(currentUser?.img);
    const newAvatarPath = `/uploads/avatars/${req.file.filename}`;
    await User.findByIdAndUpdate(req.user._id, { img: newAvatarPath });
    res.status(200).json({ avatarPath: newAvatarPath });
  } catch (err: any) {
    console.error('API avatar upload error:', err);
    res.status(500).json({ success: false, error: 'Failed to update avatar' });
  }
});

router.post('/account/avatar/import-gravatar', async (req: any, res: any) => {
  try {
    const currentUser: any = await User.findById(req.user._id);
    const hash = crypto.createHash('sha256').update(currentUser.email.trim().toLowerCase()).digest('hex');
    const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?s=256&d=404`;

    // fetch() rejects on DNS/connection/timeout failures; map those to the same 502 as
    // an explicit non-ok response so an offline instance doesn't surface a 500.
    let gravatarRes: any;
    try {
      gravatarRes = await fetch(gravatarUrl, { signal: AbortSignal.timeout(5000) });
    } catch (fetchErr: any) {
      console.error('API Gravatar fetch error:', fetchErr);
      return res.status(502).json({ success: false, error: 'Gravatar fetch failed' });
    }

    if (gravatarRes.status === 404) {
      return res.status(404).json({ success: false, error: 'No Gravatar found for this email' });
    }
    if (!gravatarRes.ok) {
      return res.status(502).json({ success: false, error: 'Gravatar fetch failed' });
    }

    const contentLength = gravatarRes.headers.get('content-length');
    if (contentLength && Number(contentLength) > 5 * 1024 * 1024) {
      return res.status(502).json({ success: false, error: 'Gravatar image too large' });
    }

    const contentType = gravatarRes.headers.get('content-type') || 'image/jpeg';
    const ext = EXT_BY_CONTENT_TYPE[contentType] || '.jpg';
    const buffer = Buffer.from(await gravatarRes.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(502).json({ success: false, error: 'Gravatar image too large' });
    }

    if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
    const filename = `avatar-${req.user._id}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(AVATARS_DIR, filename), buffer);

    removeAvatarFile(currentUser.img);
    const newAvatarPath = `/uploads/avatars/${filename}`;
    await User.findByIdAndUpdate(req.user._id, { img: newAvatarPath });
    res.status(200).json({ avatarPath: newAvatarPath });
  } catch (err: any) {
    console.error('API Gravatar import error:', err);
    res.status(500).json({ success: false, error: 'Failed to import Gravatar' });
  }
});

// Unlink the currently linked SSO (OIDC) identity. Refuses to strip the only
// credential an account has: an SSO-only account (no local password) would be
// locked out entirely if its oidc link were removed — as would any account on
// an instance where local login is disabled outright.
router.post('/account/oidc/unlink', async (req: any, res: any) => {
  try {
    if (!req.user.password || isLocalLoginDisabled()) {
      return res.status(400).json({ success: false, error: 'Cannot unlink SSO from an account with no local password' });
    }
    await User.findByIdAndUpdate(req.user._id, { $unset: { oidc: 1 } });
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API OIDC unlink error:', err);
    res.status(500).json({ success: false, error: 'Failed to unlink SSO' });
  }
});

router.delete('/account/avatar', async (req: any, res: any) => {
  try {
    const currentUser = await User.findById(req.user._id);
    removeAvatarFile(currentUser?.img);
    await User.findByIdAndUpdate(req.user._id, { img: DEFAULT_AVATAR });
    res.status(200).json({ avatarPath: DEFAULT_AVATAR });
  } catch (err: any) {
    console.error('API avatar remove error:', err);
    res.status(500).json({ success: false, error: 'Failed to remove avatar' });
  }
});

export = router;
