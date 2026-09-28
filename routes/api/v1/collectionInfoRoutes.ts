import { Router } from 'express';
import multer from 'multer';
import Collection from '../../../models/Collection';
import {
  collectionInfoOf,
  collectionInfoPatch,
  isCollectionInfoVisible,
  MAX_COLLECTION_INFO_BODY
} from '../../../core/collectionInfo';
import {
  deleteUnusedManagedItemImages,
  isJpegBuffer,
  MAX_ITEM_IMAGE_UPLOAD_BYTES,
  storeItemImage
} from '../../../core/itemImageStorage';
import { renderMarkdown } from '../../../core/markdown';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_ITEM_IMAGE_UPLOAD_BYTES }
});

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

// Rendered here rather than in the client so the preview and the page can never drift
// apart: both read core/markdown.ts.
router.post('/collections/:id/info/preview', requireApiCollectionRole('admin'), (req: any, res: any) => {
  const body = req.body?.body;
  if (typeof body !== 'string') {
    return res.status(400).json({ success: false, error: 'body must be a string' });
  }
  res.status(200).json({ html: renderMarkdown(body.slice(0, MAX_COLLECTION_INFO_BODY)) });
});

router.post('/collections/:id/info-images', requireApiCollectionRole('admin'), (req: any, res: any) => {
  upload.single('image')(req, res, async (uploadError: any) => {
    if (uploadError) {
      const tooLarge = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        error: tooLarge ? 'Image too large' : 'Invalid upload'
      });
    }
    if (!req.file || req.file.mimetype !== 'image/jpeg' || !isJpegBuffer(req.file.buffer)) {
      return res.status(400).json({ success: false, error: 'Only JPEG images are accepted' });
    }
    try {
      const url = await storeItemImage(req.file.buffer);
      res.status(201).json({ success: true, url });
    } catch (err: any) {
      console.error('[API COLLECTION INFO IMAGE] Upload failed:', err.message);
      res.status(500).json({ success: false, error: 'Upload failed' });
    }
  });
});

export = router;
