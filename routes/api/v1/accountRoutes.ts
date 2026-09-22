import { Router } from 'express';
import User from '../../../models/User';
import { requireApiAuth } from '../../../middleware/authMiddleware';

const router = Router();

router.use('/account', requireApiAuth);

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
      const trimmed = String(username).trim();
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

    await User.findByIdAndUpdate(req.user._id, set);
    const updated: any = await User.findById(req.user._id)
      .select('username theme language currency')
      .lean();
    res.status(200).json({ user: updated });
  } catch (err: any) {
    console.error('API account update error:', err);
    res.status(500).json({ success: false, error: 'Failed to update account' });
  }
});

export = router;
