import { Router } from 'express';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import User from '../../../models/User';
import Collection from '../../../models/Collection';
import BlockedIP from '../../../models/blockedIP';
import LoginLog from '../../../models/LoginLog';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiAdmin } from '../../../middleware/apiAuthMiddleware';
import { getInstanceSettings, saveInstanceSettings } from '../../../utils/instanceSettings';

const router = Router();
router.use('/admin', requireApiAuth, requireApiAdmin);

const createPassword = (length = 12): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
  let password = '';
  for (let i = 0; i < length; i++) password += chars.charAt(Math.floor(Math.random() * chars.length));
  return password;
};

router.get('/admin/instance-settings', async (req: any, res: any) => {
  res.status(200).json({ settings: await getInstanceSettings() });
});

router.patch('/admin/instance-settings', async (req: any, res: any) => {
  const patch: Record<string, any> = {};
  if (typeof req.body?.allowMemberCollectionCreation === 'boolean') {
    patch.allowMemberCollectionCreation = req.body.allowMemberCollectionCreation;
  }
  if (req.body?.maxCollectionsPerUser !== undefined) {
    const parsed = parseInt(req.body.maxCollectionsPerUser, 10);
    patch.maxCollectionsPerUser = Math.min(100, Math.max(1, isNaN(parsed) ? 1 : parsed));
  }
  try {
    await saveInstanceSettings(patch);
    res.status(200).json({ settings: await getInstanceSettings() });
  } catch (err: any) {
    console.error('API instance settings save error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save instance settings' });
  }
});

router.get('/admin/users', async (req: any, res: any) => {
  try {
    const users = await User.find().sort({ lastChange: -1 })
      .select('username email isAdmin lastChange').lean();
    res.status(200).json({
      users: users.map((u: any) => ({
        id: String(u._id), username: u.username, email: u.email,
        isAdmin: u.isAdmin, lastChange: u.lastChange
      }))
    });
  } catch (err: any) {
    console.error('API user list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

router.post('/admin/users', async (req: any, res: any) => {
  const { username, email } = req.body || {};
  if (!username || !email) {
    return res.status(400).json({ success: false, error: 'username and email are required' });
  }
  try {
    const password = createPassword();
    // Hash before the single create: the User schema has no save hook, so
    // creating with the plaintext and overwriting it would store it in the clear
    // between the two writes (same reasoning as collectionsRoutes' member add).
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ username, email, password: hashedPassword, lastChange: new Date() });
    console.log(`[API ADMIN] User created: ${username} <${email}> by ${req.user.email}`);
    res.status(201).json({
      user: { id: String(newUser._id), username, email, isAdmin: false },
      generatedPassword: password
    });
  } catch (err: any) {
    console.error('API user create error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/users/:userId/reset-password', async (req: any, res: any) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  try {
    const target = await User.findById(userId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    // Instance admins are peers: none may reset another instance admin's password
    // (would let them hijack the account). Resetting your own is still allowed.
    if (target.isAdmin && String(target._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Cannot reset another admin\'s password' });
    }

    const password = createPassword();
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.updateOne({ _id: userId }, { $set: { password: hashedPassword, lastChange: new Date() } });
    res.status(200).json({ generatedPassword: password });
  } catch (err: any) {
    console.error('API user password reset error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

router.delete('/admin/users/:userId', async (req: any, res: any) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  if (String(userId) === String(req.user._id)) {
    return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
  }
  try {
    const target = await User.findById(userId);
    if (target?.isAdmin) {
      return res.status(403).json({ success: false, error: 'Cannot delete another admin' });
    }
    await User.findByIdAndDelete(userId);
    await Collection.updateMany({}, { $pull: { members: { user: userId } } });
    console.log(`[API ADMIN] User deleted: ${userId} by ${req.user.email}`);
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API user delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

router.get('/admin/blocked-ips', async (req: any, res: any) => {
  try {
    const blockedIps = await BlockedIP.find().sort({ createdAt: -1 }).lean();
    res.status(200).json({
      blockedIps: blockedIps.map((b: any) => ({ id: String(b._id), ip: b.ip, createdAt: b.createdAt }))
    });
  } catch (err: any) {
    console.error('API blocked IP list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list blocked IPs' });
  }
});

router.post('/admin/blocked-ips', async (req: any, res: any) => {
  try {
    const ip = String(req.body?.ip ?? '').trim();
    if (!ip) {
      return res.status(400).json({ success: false, error: 'ip is required' });
    }
    const existing = await BlockedIP.findOne({ ip });
    if (existing) {
      console.log(`[API ADMIN] IP already blocked: ${ip}`);
      return res.status(200).json({ blockedIp: { id: String(existing._id), ip: existing.ip, createdAt: existing.createdAt } });
    }
    const created = await BlockedIP.create({ ip });
    console.log(`[API ADMIN] IP blocked: ${ip} by ${req.user.email}`);
    res.status(201).json({ blockedIp: { id: String(created._id), ip: created.ip, createdAt: created.createdAt } });
  } catch (err: any) {
    console.error('API blocked IP create error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to block IP' });
  }
});

router.delete('/admin/blocked-ips/:id', async (req: any, res: any) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  try {
    const deleted = await BlockedIP.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    console.log(`[API ADMIN] IP unblocked: ${req.params.id} by ${req.user.email}`);
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API blocked IP delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to unblock IP' });
  }
});

router.get('/admin/login-logs', async (req: any, res: any) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20));
    const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(limit).lean();
    res.status(200).json({
      logs: logs.map((l: any) => ({
        id: String(l._id), username: l.username, email: l.email, ip: l.ip,
        country: l.country, city: l.city, userAgent: l.userAgent,
        status: l.status, timestamp: l.timestamp
      }))
    });
  } catch (err: any) {
    console.error('API login log list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list login logs' });
  }
});

router.delete('/admin/login-logs', async (req: any, res: any) => {
  const n = parseInt(req.query.count as string, 10);
  if (!n || n < 1) {
    return res.status(400).json({ success: false, error: 'count is required and must be >= 1' });
  }
  try {
    const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(n).select('_id');
    const ids = logs.map((l: any) => l._id);
    const result = await LoginLog.deleteMany({ _id: { $in: ids } });
    res.status(200).json({ deleted: result.deletedCount });
  } catch (err: any) {
    console.error('API login log delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete login logs' });
  }
});

export = router;
