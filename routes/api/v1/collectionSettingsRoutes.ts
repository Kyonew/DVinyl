import { Router } from 'express';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import Settings from '../../../models/Settings';
import { buildSettingsOptions, buildSettingsUpdate, getCollectionSettings, serializeCollectionSettings } from '../../../utils/collectionSettings';

const router = Router();

router.use(requireApiAuth);

router.get('/collections/:id/settings', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const settings = await getCollectionSettings(req.apiCollection._id);
  res.status(200).json({ settings: serializeCollectionSettings(settings) });
});

router.patch('/collections/:id/settings', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const current = await getCollectionSettings(req.apiCollection._id);
  const verdict = await buildSettingsUpdate(req.apiCollection._id, current, req.body ?? {});
  if (verdict.error) {
    const body: any = { success: false, error: verdict.error };
    if (verdict.code) body.code = verdict.code;
    return res.status(400).json(body);
  }
  const updated = await Settings.findOneAndUpdate(
    { collection: req.apiCollection._id },
    { $set: verdict.update! },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  res.status(200).json({ settings: serializeCollectionSettings(updated) });
});

router.get('/collections/:id/settings/options', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  res.status(200).json({ options: buildSettingsOptions() });
});

export = router;
