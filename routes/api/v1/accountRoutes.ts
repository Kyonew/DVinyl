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

export = router;
