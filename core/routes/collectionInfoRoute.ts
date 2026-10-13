import express from 'express';
import { requireAuthOrShareView } from '../../middleware/authMiddleware';
import { collectionInfoOf, isCollectionInfoVisible } from '../collectionInfo';
import { renderMarkdown } from '../markdown';

const router = express.Router();

/**
 * The collection's own page: what it is, and whatever its admin wants to say about it.
 * Open to share-link visitors as well as members (a shared QR code is exactly where a
 * few words of context are worth the most), which is why the visibility check happens
 * here and not only in the views that link to it.
 */
router.get('/info', requireAuthOrShareView, async (req: any, res: any) => {
  try {
    const collection = res.locals.activeCollection;
    if (!collection) {
      return res.render('no-collection', { user: res.locals.user, msgKey: req.query.msg });
    }

    const info = collectionInfoOf(collection);

    // An admin reaches the page from the editor before it is turned on, so they see the
    // draft as it will look. Everybody else gets the 404 of a page that is not there.
    if (!isCollectionInfoVisible(collection, res.locals.isShareView) && !res.locals.isCollectionAdmin) {
      return res.status(404).render('404');
    }

    res.render('collection-info', {
      user: res.locals.user,
      settings: res.locals.settings,
      collectionName: collection.name,
      info,
      infoHtml: renderMarkdown(info.body),
      // An admin looking at a page nobody else can reach yet: it is off, or it has
      // nothing on it to show.
      isDraft: !isCollectionInfoVisible(collection, res.locals.isShareView),
      // Live for the members, but the share links stop at the collection. Worth saying
      // to the admin who wrote it, and to nobody else.
      hiddenFromShare: res.locals.isCollectionAdmin && info.enabled && !info.shareVisible
    });
  } catch (err: any) {
    console.error('[ERR] Collection info:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

export default router;
