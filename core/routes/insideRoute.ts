/**
 * Putting an item inside another one and taking it out again (core/insideItems.ts), from
 * the item's page.
 */
import express from 'express';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { visibilityFilter } from '../../utils/visibilityHelper';
import { boxCandidates, itemHref, putInside, takeOut } from '../insideItems';
import { itemImageUrl } from '../itemImageStorage';
import { registry } from '../registry';

const router = express.Router();
const editor = [requireAuth, requireCollectionRole('editor')];

// The boxes an item could go in, for the picker on its page.
router.get('/api/inside/candidates', ...editor, async (req: any, res: any) => {
  try {
    const visible = visibilityFilter(res.locals.isCollectionAdmin, res.locals.settings);
    const found = await boxCandidates(res.locals.activeCollectionId, req.query.item, String(req.query.q || ''), visible);
    res.json({
      success: true,
      items: found.map((box: any) => {
        const plugin = registry.getByKind(box.kind);
        const image = Array.isArray(box.images) && box.images[0] ? itemImageUrl(box.images[0]) : (box.cover_image || '');
        return {
          id: String(box._id),
          title: box.title || '',
          year: box.year || '',
          type: plugin ? req.t(plugin.label, { defaultValue: plugin.label }) : '',
          image,
          href: itemHref(box)
        };
      }).filter((box: any) => box.href)
    });
  } catch (err: any) {
    console.error('[INSIDE] Candidates failed:', err.message);
    res.status(500).json({ success: false });
  }
});

router.post('/api/inside/:id', ...editor, async (req: any, res: any) => {
  try {
    const refused = await putInside(res.locals.activeCollectionId, req.params.id, req.body?.box);
    if (refused) return res.status(refused === 'not_found' ? 404 : 400).json({ success: false, error: req.t(`inside.error_${refused}`) });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[INSIDE] Put inside failed:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

router.post('/api/inside/:id/out', ...editor, async (req: any, res: any) => {
  try {
    await takeOut(res.locals.activeCollectionId, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[INSIDE] Take out failed:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

export default router;
