import express from 'express';
import { db } from '../db';
import { and, asc, contains, desc, each, eq, Filter, idOf, isId, isIn, missing, or, size } from '../db/query';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { escapeRegExp } from '../helpers';
import { registry } from '../registry';
import { itemImageUrl } from '../itemImageStorage';
import {
  ownList, isListKind, cleanListName, cleanListDescription, resolveListEntries, listCovers,
  pluginsWithTracks, MAX_LIST_ENTRIES, MAX_LIST_BULK_ADD
} from '../listStore';

/**
 * Lists: named selections of a collection's items ("Backlog", "Finished in 2026") or of
 * their tracks (a playlist). They belong to the collection like its shelves do: every
 * member reads them, editors arrange them. Share links do not reach them yet.
 */
const router = express.Router();

const wantsJson = (req: any) => (req.headers.accept || '').includes('json') || req.is('application/json');

// GET /lists -> every list of the active collection
router.get('/lists', requireAuth, requireCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    const collectionId = res.locals.activeCollectionId;
    if (!collectionId) {
      return res.render('no-collection', { user: res.locals.user, msgKey: req.query.msg });
    }

    const lists = await db.lists.find(eq('collection', idOf(collectionId)), { sort: [desc('updated_at')] });
    const covers = await listCovers(lists, collectionId);

    res.render('lists', {
      user: res.locals.user,
      settings: res.locals.settings,
      lists: lists.map((list: any) => ({
        id: String(list._id),
        name: list.name,
        description: list.description || '',
        kind: list.kind,
        count: (list.entries || []).length,
        covers: covers.get(String(list._id)) || []
      })),
      canMakePlaylists: pluginsWithTracks(res.locals.settings).length > 0
    });
  } catch (err: any) {
    console.error('[ERR] Lists page:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// GET /lists/:id -> one list, its lines in their arranged order
router.get('/lists/:id', requireAuth, requireCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    const collectionId = res.locals.activeCollectionId;
    const list: any = collectionId ? await ownList(collectionId, req.params.id) : null;
    if (!list) return res.status(404).render('404');

    const lines = await resolveListEntries(list, collectionId);

    res.render('list', {
      user: res.locals.user,
      settings: res.locals.settings,
      list: {
        id: String(list._id),
        name: list.name,
        description: list.description || '',
        kind: list.kind
      },
      lines
    });
  } catch (err: any) {
    console.error('[ERR] List page:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /lists -> create a list. Answers JSON to the picker, which creates one in passing,
// and redirects to the new list from the plain form of the list page.
router.post('/lists', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const collectionId = res.locals.activeCollectionId;
    const name = cleanListName(req.body?.name);
    const kind = isListKind(req.body?.kind) ? req.body.kind : 'items';
    if (!collectionId || !name) {
      if (wantsJson(req)) return res.status(400).json({ success: false, error: req.t('lists.err_name_required') });
      return res.redirect('/lists');
    }

    const list: any = await db.lists.create({
      collection: collectionId,
      name,
      kind,
      description: cleanListDescription(req.body?.description),
      createdBy: req.user._id
    });

    if (wantsJson(req)) {
      return res.json({ success: true, list: { id: String(list._id), name: list.name, kind: list.kind, count: 0 } });
    }
    res.redirect(`/lists/${list._id}`);
  } catch (err: any) {
    console.error('[ERR] List create:', err.message);
    if (wantsJson(req)) return res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /lists/:id/edit -> rename, or rewrite the description
router.post('/lists/:id/edit', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const list: any = await ownList(res.locals.activeCollectionId, req.params.id);
    if (!list) return res.status(404).render('404');

    const name = cleanListName(req.body?.name);
    await db.lists.updateOne(eq('_id', idOf(list._id)), {
      set: { ...(name ? { name } : {}), description: cleanListDescription(req.body?.description) }
    }, { validate: true });
    res.redirect(`/lists/${list._id}`);
  } catch (err: any) {
    console.error('[ERR] List edit:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /lists/:id/delete -> the list goes, the items it named stay where they are
router.post('/lists/:id/delete', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const list: any = await ownList(res.locals.activeCollectionId, req.params.id);
    if (list) await db.lists.deleteOne(eq('_id', idOf(list._id)));
    res.redirect('/lists');
  } catch (err: any) {
    console.error('[ERR] List delete:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// GET /api/lists?kind=items|tracks[&item=<id>[&track=<id>]] -> the lists a picker offers,
// each saying whether it already holds the item (or the track) the picker was opened on.
router.get('/api/lists', requireAuth, requireCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    const collectionId = res.locals.activeCollectionId;
    const kind = isListKind(req.query.kind) ? req.query.kind : 'items';
    const item = isId(req.query.item) ? String(req.query.item) : '';
    const track = isId(req.query.track) ? String(req.query.track) : '';

    const lists = await db.lists.find(and(eq('collection', idOf(collectionId)), eq('kind', kind)), { sort: [desc('updated_at')] });
    res.json({
      success: true,
      lists: lists.map((list: any) => ({
        id: String(list._id),
        name: list.name,
        count: (list.entries || []).length,
        contains: !!item && (list.entries || []).some((e: any) =>
          String(e.item) === item && (kind === 'items' || String(e.track) === track)
        )
      }))
    });
  } catch (err: any) {
    console.error('[ERR] Lists API:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// How many matches the list page's search offers at once: enough to find something by
// a few letters of its name, few enough to read without scrolling.
const MAX_CANDIDATES = 20;

// GET /api/lists/:id/candidates?q= -> what the list page's "Add" search offers: the
// collection's items for a list of items, the tracks of its items for a playlist. Each
// says whether the list already holds it.
router.get('/api/lists/:id/candidates', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const collectionId = res.locals.activeCollectionId;
    const list: any = await ownList(collectionId, req.params.id);
    if (!list) return res.status(404).json({ success: false, error: req.t('errors.not_found') });

    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q.length < 1) return res.json({ success: true, results: [] });
    const regex = new RegExp(escapeRegExp(q), 'i');
    const plugins = registry.getEnabled(res.locals.settings);
    const describe = (raw: any) => {
      const plugin = registry.getByKind(raw.kind);
      const view = plugin ? plugin.formatForView(raw) : raw;
      // Format and year tell two copies of one title apart (the vinyl and the CD).
      const formatValue = String(raw.format || raw.media_type || '').toLowerCase();
      const format = (plugin?.formats || []).find(f => f.value === formatValue);
      return {
        item: String(raw._id),
        title: raw.title || '',
        creator: plugin?.creatorField ? String(raw[plugin.creatorField] || '') : '',
        details: [format ? req.t(format.label) : '', raw.year].filter(Boolean).join(' · '),
        cover: itemImageUrl(view.cover_image || '')
      };
    };

    if (list.kind === 'tracks') {
      // Only the tracks whose title matches, not every track of an album that does.
      const items = await db.items.find(
        and(eq('collection', idOf(collectionId)), missing('parent'), contains('tracklist.title', q)),
        { sort: [asc('sort_title')], limit: MAX_CANDIDATES }
      );
      const present = new Set(list.entries.map((e: any) => `${e.item}:${e.track}`));
      const results: any[] = [];
      for (const raw of items as any[]) {
        for (const track of raw.tracklist || []) {
          if (!regex.test(track.title || '') || results.length >= MAX_CANDIDATES) continue;
          results.push({
            ...describe(raw),
            track: String(track._id),
            trackTitle: track.title,
            position: track.position || '',
            inList: present.has(`${raw._id}:${track._id}`)
          });
        }
      }
      return res.json({ success: true, results });
    }

    // Same fields as the collection's own search box. Items held inside another (the
    // seasons of a show) stay out, as they do from every listing.
    const searchFields = ['title', 'barcode', ...new Set(plugins.map(p => p.creatorField).filter(Boolean))];
    const items = await db.items.find(
      and(eq('collection', idOf(collectionId)), missing('parent'), or(...searchFields.map(field => contains(field, q)))),
      { sort: [asc('sort_title')], limit: MAX_CANDIDATES }
    );
    const present = new Set(list.entries.map((e: any) => String(e.item)));
    res.json({
      success: true,
      results: (items as any[]).map(raw => ({ ...describe(raw), inList: present.has(String(raw._id)) }))
    });
  } catch (err: any) {
    console.error('[ERR] List candidates:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// POST /api/lists/:id/add -> { items: [ids] } for a list of items, { item, track } for a
// playlist. What the list already holds is skipped rather than doubled.
router.post('/api/lists/:id/add', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const collectionId = res.locals.activeCollectionId;
    const list: any = await ownList(collectionId, req.params.id);
    if (!list) return res.status(404).json({ success: false, error: req.t('errors.not_found') });

    let additions: { item: any; track?: any }[] = [];

    if (list.kind === 'tracks') {
      const { item, track } = req.body || {};
      if (!isId(item) || !isId(track)) return res.status(400).json({ success: false, error: 'bad_request' });
      const owner = await db.items.exists(and(eq('_id', item), eq('collection', idOf(collectionId)), eq('tracklist._id', track)));
      if (!owner) return res.status(404).json({ success: false, error: req.t('errors.not_found') });
      const already = list.entries.some((e: any) => String(e.item) === item && String(e.track) === track);
      if (!already) additions = [{ item, track }];
    } else {
      const ids: string[] = (Array.isArray(req.body?.items) ? req.body.items : [])
        .filter(isId)
        .slice(0, MAX_LIST_BULK_ADD);
      // Only the collection's own items, whatever ids the request carries
      const found = await db.items.find(and(isIn('_id', ids), eq('collection', idOf(collectionId))), { fields: ['_id'] });
      const valid = new Set(found.map((f: any) => String(f._id)));
      const present = new Set(list.entries.map((e: any) => String(e.item)));
      additions = [...new Set(ids)]
        .filter(id => valid.has(id) && !present.has(id))
        .map(item => ({ item }));
    }

    if (list.entries.length + additions.length > MAX_LIST_ENTRIES) {
      return res.status(400).json({ success: false, error: req.t('lists.err_full', { max: MAX_LIST_ENTRIES }) });
    }

    if (additions.length > 0) {
      await db.lists.updateOne(eq('_id', idOf(list._id)), { push: { entries: each(additions) } });
    }
    res.json({ success: true, added: additions.length, count: list.entries.length + additions.length });
  } catch (err: any) {
    console.error('[ERR] List add:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// POST /api/lists/:id/remove -> { entryId } from the list page, or { item[, track] } from
// a picker, which knows what it was opened on but not where that sits in the list.
router.post('/api/lists/:id/remove', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const list: any = await ownList(res.locals.activeCollectionId, req.params.id);
    if (!list) return res.status(404).json({ success: false, error: req.t('errors.not_found') });

    const { entryId, item, track } = req.body || {};
    let match: Filter | null = null;
    if (isId(entryId)) match = eq('_id', entryId);
    else if (isId(item)) match = list.kind === 'tracks' ? (isId(track) ? and(eq('item', item), eq('track', track)) : null) : eq('item', item);
    if (!match) return res.status(400).json({ success: false, error: 'bad_request' });

    await db.lists.updateOne(eq('_id', idOf(list._id)), { pull: { entries: match } });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] List remove:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// POST /api/lists/:id/reorder -> { order: [entryIds] }, the whole list in its new order.
// Refused unless it names exactly the lines the list holds, so a page drawn before
// someone else changed the list cannot drop or double a line.
router.post('/api/lists/:id/reorder', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const list: any = await ownList(res.locals.activeCollectionId, req.params.id);
    if (!list) return res.status(404).json({ success: false, error: req.t('errors.not_found') });

    const order: string[] = Array.isArray(req.body?.order) ? req.body.order.map(String) : [];
    const byId = new Map(list.entries.map((e: any) => [String(e._id), e]));
    const sameSet = order.length === byId.size && new Set(order).size === order.length && order.every(id => byId.has(id));
    if (!sameSet) return res.status(409).json({ success: false, error: req.t('lists.err_stale') });

    // Written only if the list still holds exactly these lines: an add or a removal that
    // landed since it was read makes this match nothing, instead of being overwritten.
    const result = await db.lists.updateOne(
      and(eq('_id', idOf(list._id)), size('entries', order.length), ...order.map(id => eq('entries._id', id))),
      { set: { entries: order.map(id => byId.get(id)) } }
    );
    if (result.matched === 0) return res.status(409).json({ success: false, error: req.t('lists.err_stale') });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] List reorder:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

export default router;
