import express from 'express';
import multer from 'multer';
import { requireAuth, requireCollectionRole } from '../middleware/authMiddleware';
import {
  isJpegBuffer,
  MAX_ITEM_IMAGE_UPLOAD_BYTES,
  storeItemImage
} from '../core/itemImageStorage';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_ITEM_IMAGE_UPLOAD_BYTES }
});

router.post(
  '/api/item-images/upload',
  requireAuth,
  requireCollectionRole('editor'),
  (req: any, res: any) => {
    upload.single('image')(req, res, async (uploadError: any) => {
      if (uploadError) {
        const tooLarge = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
        return res.status(tooLarge ? 413 : 400).json({
          success: false,
          error: req.t(tooLarge ? 'image_manager.upload_too_large' : 'image_manager.upload_invalid')
        });
      }

      if (!req.file || req.file.mimetype !== 'image/jpeg' || !isJpegBuffer(req.file.buffer)) {
        return res.status(400).json({ success: false, error: req.t('image_manager.upload_invalid') });
      }

      try {
        const url = await storeItemImage(req.file.buffer);
        return res.status(201).json({ success: true, url });
      } catch (err) {
        console.error('[ITEM IMAGE] Upload failed:', err);
        return res.status(500).json({ success: false, error: req.t('image_manager.upload_failed') });
      }
    });
  }
);

export = router;
