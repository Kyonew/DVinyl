import { Router } from 'express';
import List from '../../../models/List';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import {
  cleanListDescription, cleanListName, isListKind, listCovers, pluginsWithTracks
} from '../../../core/listStore';

const router = Router();

router.use(requireApiAuth);

/** The JSON shape every list summary shares. `covers` is filled by the caller. */
function summarize(list: any, covers: string[] = []): any {
  return {
    id: String(list._id),
    name: list.name,
    description: list.description || '',
    kind: list.kind,
    count: (list.entries || []).length,
    covers
  };
}

router.get('/collections/:id/lists', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    const collectionId = req.apiCollection._id;
    const settings = await getCollectionSettings(collectionId);
    const lists = await List.find({ collection: collectionId }).sort({ updated_at: -1 }).lean();
    const covers = await listCovers(lists, collectionId);
    res.status(200).json({
      lists: lists.map((list: any) => summarize(list, covers.get(String(list._id)) || [])),
      canMakePlaylists: pluginsWithTracks(settings).length > 0
    });
  } catch (err: any) {
    console.error('API list summaries error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list lists' });
  }
});

router.post('/collections/:id/lists', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const name = cleanListName(req.body?.name);
    if (!name) return res.status(400).json({ success: false, error: 'A list name is required' });
    if (req.body?.kind !== undefined && !isListKind(req.body.kind)) {
      return res.status(400).json({ success: false, error: 'Invalid list kind' });
    }

    const created: any = await List.create({
      collection: req.apiCollection._id,
      name,
      kind: req.body?.kind ?? 'items',
      description: cleanListDescription(req.body?.description),
      createdBy: req.user._id
    });
    res.status(201).json({ list: summarize(created.toObject()) });
  } catch (err: any) {
    console.error('API list create error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create list' });
  }
});

export = router;
