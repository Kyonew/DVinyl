import { Router } from 'express';
import Collection from '../../../models/Collection';
import {
  collectionInfoOf,
  collectionInfoPatch,
  isCollectionInfoVisible
} from '../../../core/collectionInfo';
import { deleteUnusedManagedItemImages } from '../../../core/itemImageStorage';
import { renderMarkdown } from '../../../core/markdown';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';

const router = Router();

router.use(requireApiAuth);

/**
 * The page as one caller sees it. `info` and `bodyHtml` are withheld from a member when
 * the page is not visible, so an unpublished draft never reaches them; a collection admin
 * instead gets the saved draft, marked `draft`, so the editor can reopen it.
 */
function pageFor(collection: any, isAdmin: boolean) {
  const info = collectionInfoOf(collection);
  const visible = isCollectionInfoVisible(collection, false);
  if (!visible && !isAdmin) {
    return { info: null, bodyHtml: '', visible: false, draft: false };
  }
  return { info, bodyHtml: renderMarkdown(info.body), visible, draft: !visible };
}

router.get('/collections/:id/info', requireApiCollectionRole('viewer'), (req: any, res: any) => {
  res.status(200).json(pageFor(req.apiCollection, req.apiCollectionRole === 'admin'));
});

router.patch('/collections/:id/info', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const current = collectionInfoOf(req.apiCollection);
    const verdict = collectionInfoPatch(current, req.body || {});
    if (verdict.error) {
      return res.status(400).json({ success: false, error: verdict.error });
    }

    const next = verdict.info!;
    const changed = next.enabled !== current.enabled
      || next.shareVisible !== current.shareVisible
      || next.title !== current.title
      || next.body !== current.body
      || next.images.join('\n') !== current.images.join('\n');

    if (changed) {
      await Collection.updateOne(
        { _id: req.apiCollection._id },
        { $set: { info: { ...next, updated_at: new Date() } } }
      );
      // Released after the write deliberately: the guard inside
      // deleteUnusedManagedItemImages reads this collection's new image list, so a file
      // still on the page stays, and one an item or another collection still uses survives.
      const removed = current.images.filter(image => !next.images.includes(image));
      if (removed.length > 0) {
        try {
          await deleteUnusedManagedItemImages(removed);
        } catch (cleanupError: any) {
          console.warn('[API COLLECTION INFO] Image cleanup failed:', cleanupError.message);
        }
      }
    }

    const fresh = await Collection.findById(req.apiCollection._id);
    res.status(200).json(pageFor(fresh, req.apiCollectionRole === 'admin'));
  } catch (err: any) {
    console.error('API collection info save error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save the collection info page' });
  }
});

export = router;
