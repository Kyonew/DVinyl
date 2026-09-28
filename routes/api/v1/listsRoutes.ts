import { Router } from 'express';
import mongoose from 'mongoose';
import List from '../../../models/List';
import Item from '../../../models/Item';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import { toApiItem } from '../../../core/apiSerializers';
import {
  cleanListDescription, cleanListName, isListKind, listCovers, ownList, resolveListEntries,
  pluginsWithTracks, MAX_LIST_BULK_ADD, MAX_LIST_ENTRIES
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

const isId = (value: unknown) => typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

/** Loads the list named by `:listId` in the URL's collection, or ends the request. */
async function loadOwnList(req: any, res: any, next: any) {
  try {
    const list: any = await ownList(req.apiCollection._id, req.params.listId);
    if (!list) return res.status(404).json({ success: false, error: 'List not found' });
    req.apiList = list;
    next();
  } catch (err) {
    next(err);
  }
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

router.get('/collections/:id/lists/:listId', requireApiCollectionRole('viewer'), loadOwnList, async (req: any, res: any) => {
  try {
    const list = req.apiList;
    const collectionId = req.apiCollection._id;
    const lines = await resolveListEntries(list.toObject(), collectionId);
    const entries = lines.map((line: any) => {
      const entry: any = {
        entryId: line.entryId,
        added_at: line.addedAt,
        item: toApiItem(line.rawItem, line.plugin)
      };
      if (line.track) entry.track = line.track;
      return entry;
    });
    const covers = await listCovers([list.toObject()], collectionId);
    res.status(200).json({
      list: {
        ...summarize(list, covers.get(String(list._id)) || []),
        created_at: list.created_at,
        updated_at: list.updated_at
      },
      entries
    });
  } catch (err: any) {
    console.error('API list detail error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to read list' });
  }
});

router.patch('/collections/:id/lists/:listId', requireApiCollectionRole('editor'), loadOwnList, async (req: any, res: any) => {
  try {
    const list = req.apiList;
    const name = cleanListName(req.body?.name);
    if (name) list.name = name;
    list.description = cleanListDescription(req.body?.description);
    await list.save();
    const covers = await listCovers([list.toObject()], req.apiCollection._id);
    res.status(200).json({ list: summarize(list.toObject(), covers.get(String(list._id)) || []) });
  } catch (err: any) {
    console.error('API list edit error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update list' });
  }
});

router.delete('/collections/:id/lists/:listId', requireApiCollectionRole('editor'), loadOwnList, async (req: any, res: any) => {
  try {
    await List.deleteOne({ _id: req.apiList._id });
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API list delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete list' });
  }
});

router.post('/collections/:id/lists/:listId/entries', requireApiCollectionRole('editor'), loadOwnList, async (req: any, res: any) => {
  try {
    const list = req.apiList;
    const collectionId = req.apiCollection._id;
    let additions: { item: any; track?: any }[] = [];

    if (list.kind === 'tracks') {
      const { item, track } = req.body || {};
      if (!isId(item) || !isId(track)) {
        return res.status(400).json({ success: false, error: 'A playlist line needs an item and a track id' });
      }
      // Cast by hand: `tracklist` is declared by the plugin, not the base model this query
      // runs on, so Mongoose would compare the raw string otherwise.
      const owner = await Item.exists({
        _id: item,
        collection: collectionId,
        'tracklist._id': new mongoose.Types.ObjectId(track)
      });
      if (!owner) return res.status(404).json({ success: false, error: 'Item or track not found' });
      const already = list.entries.some((e: any) => String(e.item) === String(item) && String(e.track) === String(track));
      if (!already) additions = [{ item, track }];
    } else {
      if (!Array.isArray(req.body?.items)) {
        return res.status(400).json({ success: false, error: 'items must be an array' });
      }
      const ids: string[] = req.body.items.filter(isId).slice(0, MAX_LIST_BULK_ADD);
      // Only the collection's own items, whatever ids the request carries.
      const found = await Item.find({ _id: { $in: ids }, collection: collectionId }).select('_id').lean();
      const valid = new Set(found.map((f: any) => String(f._id)));
      const present = new Set((list.entries || []).map((e: any) => String(e.item)));
      additions = [...new Set(ids)].filter(id => valid.has(id) && !present.has(id)).map(item => ({ item }));
    }

    if ((list.entries || []).length + additions.length > MAX_LIST_ENTRIES) {
      return res.status(400).json({ success: false, error: 'The list is full' });
    }
    if (additions.length > 0) {
      await List.updateOne({ _id: list._id }, { $push: { entries: { $each: additions } } });
    }
    res.status(200).json({ success: true, added: additions.length, count: (list.entries || []).length + additions.length });
  } catch (err: any) {
    console.error('API list add error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to add to list' });
  }
});

export = router;