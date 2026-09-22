import { Router } from 'express';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiAdmin } from '../../../middleware/apiAuthMiddleware';
import { getInstanceSettings, saveInstanceSettings } from '../../../utils/instanceSettings';

const router = Router();
router.use('/admin', requireApiAuth, requireApiAdmin);

router.get('/admin/instance-settings', async (req: any, res: any) => {
  res.status(200).json({ settings: await getInstanceSettings() });
});

router.patch('/admin/instance-settings', async (req: any, res: any) => {
  const patch: Record<string, any> = {};
  if (typeof req.body.allowMemberCollectionCreation === 'boolean') {
    patch.allowMemberCollectionCreation = req.body.allowMemberCollectionCreation;
  }
  if (req.body.maxCollectionsPerUser !== undefined) {
    const parsed = parseInt(req.body.maxCollectionsPerUser, 10);
    patch.maxCollectionsPerUser = Math.min(100, Math.max(1, isNaN(parsed) ? 1 : parsed));
  }
  await saveInstanceSettings(patch);
  res.status(200).json({ settings: await getInstanceSettings() });
});

export = router;
