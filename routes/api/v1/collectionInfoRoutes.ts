import { Router } from 'express';
import {
  collectionInfoOf,
  isCollectionInfoVisible
} from '../../../core/collectionInfo';
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

export = router;
