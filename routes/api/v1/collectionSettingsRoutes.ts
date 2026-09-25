import { Router } from 'express';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { getCollectionSettings, serializeCollectionSettings } from '../../../utils/collectionSettings';

const router = Router();

router.use(requireApiAuth);

router.get('/collections/:id/settings', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const settings = await getCollectionSettings(req.apiCollection._id);
  res.status(200).json({ settings: serializeCollectionSettings(settings) });
});

export = router;
