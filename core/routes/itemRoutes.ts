import express, { Router } from 'express';
import mongoose from 'mongoose';
import { PluginDefinition } from '../types';
import Item from '../../models/Item';
import User from '../../models/User';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { parseGenresAndStyles, isBarcodeQuery, lookupBarcodeTitle, editStamp, syncStamp, safeReturnPath } from '../helpers';
import { DEFAULT_PLACEHOLDER_IMAGE } from '../placeholderImage';
import { getExtraFields, toFieldDefinitions } from '../pluginExtraFields';
import { buildFieldSuggestions } from '../fieldSuggestions';
import { deleteItemsAndContents, moveContentsToWishlist } from '../../utils/itemHelpers';

export function createItemRoutes(plugin: PluginDefinition): Router {
  const router = express.Router();

  // EXTERNAL SEARCH
  if (plugin.searchProvider) {
    // GET /add-{type} -> render 'add' page
    router.get(`/add-${plugin.id}`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      try {
        const formatParam = req.query.format as string || req.query.type as string;
        res.render('add', {
          results: null,
          searchType: formatParam || plugin.id,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          plugin
        });
      } catch (err: any) {
        console.error(`Error loading search page for ${plugin.id}:`, err.message);
        res.status(500).send(req.t('errors.generic_server_error'));
      }
    });

    // POST /search-{type} -> search results
    router.post(`/search-${plugin.id}`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      const { query, type, year, country, genre_filter, label_filter } = req.body;
      const rawQuery = typeof query === 'string' ? query.trim() : '';
      let searchQuery = rawQuery;
      let scannedBarcode = '';

      try {
        // Scanned barcode: resolve to a product title via UPC lookup first
        if (plugin.supportsBarcodeSearch && isBarcodeQuery(rawQuery)) {
          const { barcode, title } = await lookupBarcodeTitle(rawQuery, plugin.barcodeNoiseTerms);
          scannedBarcode = barcode;
          if (!title) {
            // Searching the digits themselves cannot match: these providers index titles,
            // not barcodes. Say the barcode is unknown rather than show an empty result
            // list, which reads as "you don't own this" instead of "I couldn't look it up".
            return res.render('add', {
              results: [],
              error: req.t('add_vinyl.barcode_not_found'),
              searchType: type || plugin.id,
              searchQuery: rawQuery,
              scanned_barcode: barcode,
              user: res.locals.user,
              currentType: `add-${plugin.id}`,
              plugin
            });
          }
          searchQuery = title;
        }

        const settings = res.locals.settings;
        const results = await plugin.searchProvider!.search(searchQuery, {
          type: type || plugin.id,
          year,
          country,
          genre_filter,
          label_filter,
          language: req.language,
          // Pass the plugin's own settings so the provider stays the only one that knows its option keys
          pluginSettings: settings?.pluginSettings?.[plugin.id] || {}
        });

        res.render('add', {
          results,
          searchType: type || plugin.id,
          searchQuery: rawQuery,
          scanned_barcode: scannedBarcode,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          plugin
        });
      } catch (err: any) {
        console.error(`Search error for ${plugin.id}:`, err.message);
        res.render('add', {
          results: [],
          error: req.t('errors.api_error'),
          searchType: type || plugin.id,
          searchQuery: rawQuery,
          scanned_barcode: scannedBarcode,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          plugin
        });
      }
    });

    // GET /confirm-{type}/:id -> show details from external API before saving
    router.get(`/confirm-${plugin.id}/:id`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      const externalId = req.params.id;
      const searchTypeHint = req.query.type as string | undefined;

      try {
        // The query string is forwarded whole rather than key by key: what a provider needs
        // to narrow a result down is its own business (TMDB asks which season), and the core
        // has no reason to learn the vocabulary of each one.
        const details = await plugin.searchProvider!.getDetails(externalId, {
          ...req.query,
          type: searchTypeHint,
          language: req.language
        });
        const activeCollectionId = res.locals.activeCollectionId;

        // Providers return the creator under a generic `creator` key; make sure
        // the plugin-specific field (artist, author, director, developer) is always set
        if (details.creator !== undefined && details[plugin.creatorField] === undefined) {
          details[plugin.creatorField] = details.creator;
        }

        // Barcode scanned on the add page, carried over via query string
        if (req.query.barcode) {
          details.barcode = String(req.query.barcode);
        }

        const suggestions = await buildFieldSuggestions(plugin, activeCollectionId, details);
        const genres = await Item.distinct('genre', {
          collection: activeCollectionId,
          genre: { $ne: "" },
          $or: [{ kind: plugin.kind }, { kind: { $exists: false } }]
        });

        let existingItemsArray: any[];
        if (plugin.findPotentialDuplicates) {
          existingItemsArray = await plugin.findPotentialDuplicates(activeCollectionId, details);
        } else {
          const exactDuplicate = await plugin.findDuplicate(activeCollectionId, details);
          existingItemsArray = exactDuplicate ? [exactDuplicate] : [];
        }

        res.render('confirm', {
          item: details,
          user: res.locals.user,
          suggestions,
          genres,
          currentType: plugin.collectionType,
          existingItems: existingItemsArray,
          plugin,
          isManual: false
        });
      } catch (err: any) {
        console.error(`Details fetch error for ${plugin.id} ID ${externalId}:`, err.message);
        res.render('add', {
          results: [],
          error: `${req.t('errors.api_error')} (${err.message})`,
          searchType: searchTypeHint || plugin.id,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          plugin
        });
      }
    });
  }

  // PLUGIN IMPORTERS (bulk imports: Discogs, Goodreads, CSV...). requireAdmin marks
  // bulk/destructive importers (e.g. CSV, RSS) as collection-admin-only, same tier as
  // the bulk tools in routes/adminRoutes.ts (delete-last-items, refresh-all).
  for (const importer of plugin.importers || []) {
    const middlewares = importer.requireAdmin
      ? [requireAuth, requireCollectionRole('admin')]
      : [requireAuth, requireCollectionRole('editor')];
    router.post(`/import/${importer.id}`, ...middlewares, (req: any, res: any) => importer.handler(req, res));
  }

  // PLUGIN API ROUTES (e.g. Discogs estimate for music)
  for (const apiRouteDef of plugin.apiRoutes || []) {
    const middlewares = apiRouteDef.requireAdmin
      ? [requireAuth, requireCollectionRole('admin')]
      : apiRouteDef.requireEditor
        ? [requireAuth, requireCollectionRole('editor')]
        : [requireAuth];
    (router as any)[apiRouteDef.method](apiRouteDef.path, ...middlewares, (req: any, res: any) => apiRouteDef.handler(req, res));
  }

  // MANUAL ADD ENTRY
  if (plugin.getManualDefaults) {
    router.get(`/add-${plugin.id}/manual`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      try {
        const defaults = plugin.getManualDefaults!();
        const activeCollectionId = res.locals.activeCollectionId;

        const suggestions = await buildFieldSuggestions(plugin, activeCollectionId, defaults);
        const genres = await Item.distinct('genre', {
          collection: activeCollectionId,
          genre: { $ne: "" },
          $or: [{ kind: plugin.kind }, { kind: { $exists: false } }]
        });

        res.render('confirm', {
          item: defaults,
          user: res.locals.user,
          suggestions,
          genres,
          currentType: plugin.collectionType,
          existingItems: [],
          plugin,
          isManual: true
        });
      } catch (err: any) {
        console.error(`Error loading manual add for ${plugin.id}:`, err.message);
        res.status(500).send(req.t('errors.generic_server_error'));
      }
    });
  }

  // SAVE HANDLER (Create / Update)
  router.post(`/save-${plugin.id}`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
    try {
      const {
        mongo_id, title, year, cover_image, user_image,
        in_wishlist, comments, location, quantity,
        genres, styles, barcode, barcode_locked, added_at
      } = req.body;

      const adminId = req.user._id;
      const activeCollectionId = res.locals.activeCollectionId;
      const isWishlist = in_wishlist === 'true';
      const isBarcodeLocked = barcode_locked === 'on' || barcode_locked === 'true' || barcode_locked === true;

      const { genres: parsedGenres, styles: parsedStyles } = parseGenresAndStyles(genres, styles);

      // A cover left untouched posts back whatever the form displayed, i.e. the resolved
      // placeholder. Storing it would freeze a copy of the plugin's default image on the
      // item; kept empty instead, so the item follows that default if it ever changes.
      const placeholder = plugin.placeholderImage || DEFAULT_PLACEHOLDER_IMAGE;
      const coverImage = (cover_image === placeholder || cover_image === DEFAULT_PLACEHOLDER_IMAGE)
        ? ''
        : cover_image;

      // Build updateData generic object
      const updateData: any = {
        title,
        year,
        cover_image: coverImage,
        user_image,
        in_wishlist: isWishlist,
        comments: comments || '',
        location: location || '',
        quantity: parseInt(quantity) || 1,
        genre: req.body.genre || (parsedGenres.length > 0 ? parsedGenres[0] : ''),
        genres: parsedGenres,
        styles: parsedStyles,
        barcode: barcode || '',
        barcode_locked: isBarcodeLocked,
        added_at: added_at ? new Date(added_at) : new Date(),
        kind: plugin.kind
      };

      // createItemRoutes() captures the shared plugin singleton at boot, so the fields
      // the per-collection decoration layer adds for the views are absent here. They
      // are read back from the active collection's settings, otherwise everything the
      // form posts for them would be silently dropped.
      const extraFields = toFieldDefinitions(getExtraFields(res.locals.settings, plugin.id));
      const extraValues: Record<string, any> = {};

      // Handle plugin specific fields
      for (const field of [...plugin.formFields, ...extraFields]) {
        if ([
          'title', 'year', 'cover_image', 'user_image', 'in_wishlist', 'comments',
          'location', 'quantity', 'barcode', 'barcode_locked', 'added_at', 'genres', 'styles', 'genre'
        ].includes(field.name)) {
          continue;
        }

        let value = req.body[field.name];

        if (field.type === 'custom' && req.body[`${field.name}_json`]) {
          // Custom editors (e.g. the tracklist editor) post their value as `<name>_json`
          value = JSON.parse(req.body[`${field.name}_json`]);
        } else if (field.type === 'number') {
          value = value ? Number(value) : undefined;
        } else if (field.type === 'date') {
          // The date input posts YYYY-MM-DD, parsed as UTC midnight so the stored day
          // never shifts with the server timezone. An emptied input yields null rather
          // than undefined, so clearing the field actually unsets the stored value
          // instead of leaving the previous one in place.
          const raw = typeof value === 'string' ? value.trim() : value;
          const parsed = !raw ? null
            : new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
          value = parsed && !isNaN(parsed.getTime()) ? parsed : null;
        } else if (field.type === 'boolean') {
          value = value === 'on' || value === 'true' || value === true;
        } else if (field.type === 'tags' && typeof value === 'string') {
          // Tags inputs post a raw comma-separated string. Plugins with their own
          // schema path split it in normalizeForSave(); extra fields have no plugin
          // to do it for them, so the generic split happens here.
          if (field.extraField) {
            value = value.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }

        if (value !== undefined) {
          if (field.extraField) {
            extraValues[field.name] = value;
          } else {
            updateData[field.name] = value;
          }
        }
      }

      if (Object.keys(extraValues).length > 0) {
        updateData.extra = extraValues;
      }

      // Plugin schema fields without a form field (external ids like discogs_id,
      // tmdb_id, igdb_id, hardcover_slug...) are posted as hidden inputs
      for (const key of Object.keys(plugin.schemaDefinition)) {
        if (updateData[key] === undefined && req.body[key] !== undefined && req.body[key] !== '') {
          updateData[key] = req.body[key];
        }
      }

      // Optional per-plugin normalization (e.g. books mirror barcode <-> isbn)
      if (typeof plugin.normalizeForSave === 'function') {
        plugin.normalizeForSave(updateData);
      }

      // Asked before the duplicate lookup below, which assumes one submission is one
      // document: a show being added with its seasons has to decide for itself what is
      // already there and what attaches to what.
      if (!mongo_id && typeof plugin.handleCreate === 'function') {
        const handled = await plugin.handleCreate(updateData, {
          body: req.body,
          ownerId: adminId,
          collectionId: activeCollectionId,
          language: req.language
        });
        if (handled) {
          return res.redirect(isWishlist ? '/wishlist' : `/collection?type=${plugin.collectionType}`);
        }
      }

      let existingItem: any;
      let isEdit = false;

      if (mongo_id) {
        // Scope the edit to the active collection so a stale mongo_id (e.g. from a
        // form left open after switching collections) can't target another item. A
        // miss here must fail outright, not fall through to the duplicate-match
        // branch below and silently overwrite an unrelated item.
        existingItem = await Item.findOne({ _id: mongo_id, collection: activeCollectionId });
        if (!existingItem) {
          return res.status(404).send(req.t('errors.not_found'));
        }
        isEdit = true;
      } else if (res.locals.settings?.mergeDuplicates !== false) {
        // Opt-out per collection: with the merge disabled every add gets its own entry
        // instead of bumping the matching item's quantity. Settings documents predating
        // the option have no value at all, so only an explicit false turns it off.
        existingItem = await plugin.findDuplicate(activeCollectionId, req.body);
      }

      if (existingItem) {
        const qtyToAdd = parseInt(quantity) || 1;
        const finalQty = isEdit ? qtyToAdd : (existingItem.quantity || 1) + qtyToAdd;

        let saveObj: any;
        if (isEdit) {
          saveObj = { ...updateData, quantity: finalQty };
          // Do not reset the added date when editing an existing item
          if (!added_at) {
            saveObj.added_at = existingItem.added_at || new Date();
          }
        } else {
          // Duplicate: increment quantity and backfill identifiers/metadata the existing record
          // still lacks: the external id, the barcode, plus any plugin-declared backfillFields
          // (e.g. books' isbn). This enriches a manually-added item once matched via search.
          saveObj = { quantity: finalQty };
          const idField = plugin.externalIdField;
          const backfillKeys = new Set<string>(['barcode', ...(plugin.backfillFields || [])]);
          if (idField) backfillKeys.add(idField);
          for (const key of backfillKeys) {
            const incoming = updateData[key];
            const existingEmpty = existingItem[key] === undefined || existingItem[key] === null || existingItem[key] === '';
            if (incoming !== undefined && incoming !== null && incoming !== '' && existingEmpty) {
              saveObj[key] = (key === idField && /^\d+$/.test(String(incoming))) ? parseInt(String(incoming)) : incoming;
            }
          }
        }

        // Address the extra values one key at a time: `$set: { extra: {...} }` would
        // replace the whole bag and drop the values of any field this form did not
        // carry (one removed from the settings, or declared in another collection).
        if (saveObj.extra && typeof saveObj.extra === 'object') {
          for (const [key, value] of Object.entries(saveObj.extra)) {
            saveObj[`extra.${key}`] = value;
          }
          delete saveObj.extra;
        }

        // Through the discriminator model, not the base one. The form posts every value as
        // a string, and the base schema knows nothing of `tmdb_id` or `discogs_id`, so with
        // strict off they were written raw: one edit was enough to turn a numeric external
        // id into "1396", which then matched nothing that looked it up as a number.
        // `strict: false` still lets the user-defined `extra.*` keys through.
        const EditModel = mongoose.model(plugin.kind);
        await EditModel.updateOne(
          { _id: existingItem._id },
          { $set: { ...saveObj, ...editStamp(adminId) } },
          { strict: false }
        );
      } else {
        const Model = mongoose.model(plugin.kind);
        await Model.create({
          ...updateData,
          owner: adminId,
          collection: activeCollectionId
        });
      }

      // An edit lands back on the item, where the change can be seen; the page it was
      // started from travels along, so the item's own back arrow still returns there with
      // its filters and page number. Adding is different and keeps going to the list,
      // which is where someone looks for what they just added.
      const returnTo = safeReturnPath(req.body.return_to, req.get('host'));
      if (isEdit && existingItem) {
        const origin = returnTo ? `?from=${encodeURIComponent(returnTo)}` : '';
        res.redirect(`${plugin.routePrefix}/${existingItem._id}${origin}`);
      } else if (isWishlist) {
        res.redirect('/wishlist');
      } else {
        res.redirect(`/collection?type=${plugin.collectionType}`);
      }
    } catch (err: any) {
      console.error(`Save error for ${plugin.id}:`, err);
      res.status(500).send(req.t('errors.generic_server_error'));
    }
  });

  // STANDARD CRUD ROUTE ACTIONS
  // GET /{prefix}/edit/:id -> edit form
  router.get(`${plugin.routePrefix}/edit/:id`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).send(req.t('errors.not_found'));
      }
      const activeCollectionId = res.locals.activeCollectionId;
      const item = await Item.findOne({ _id: req.params.id, collection: activeCollectionId });
      if (!item) {
        return res.status(404).send(req.t('errors.not_found'));
      }

      const suggestions = await buildFieldSuggestions(plugin, activeCollectionId, item);
      const genres = await Item.distinct('genre', {
        collection: activeCollectionId,
        genre: { $ne: "" },
        $or: [{ kind: plugin.kind }, { kind: { $exists: false } }]
      });

      res.render('edit', {
        item: plugin.formatForView(item),
        plugin,
        suggestions,
        genres,
        // Handed over by the item page and posted back with the form: the Referer here is
        // the item page, which is not where anyone wants to land after saving.
        backUrl: safeReturnPath(req.query.from, req.get('host')),
        user: res.locals.user
      });
    } catch (err: any) {
      console.error(`Edit form error for ${plugin.id}:`, err.message);
      res.status(500).send(req.t('errors.generic_server_error'));
    }
  });

  // GET /{prefix}/:id -> details view
  router.get(`${plugin.routePrefix}/:id`, requireAuth, async (req: any, res: any) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).send(req.t('errors.not_found'));
      }
      const item = await Item.findOne({ _id: req.params.id, collection: res.locals.activeCollectionId });
      if (!item) {
        return res.status(404).send(req.t('errors.not_found'));
      }

      const formatted = plugin.formatForView(item);
      const variants = await plugin.getVariants(formatted);

      // Who put the item there. Read separately rather than populated, so formatForView
      // keeps receiving the raw document it expects. A member removed since then leaves
      // a dangling reference, which simply reads as unknown.
      // What this item holds, if anything: the seasons of a show. Kept out of every
      // listing, so this page is the only way to them, which is also why deleting the
      // holder takes them along.
      // Where this page was opened from, so leaving it, editing or deleting comes back to
      // the very page someone was on rather than the first one. The explicit parameter
      // wins: after saving an edit the header points at the form, while the parameter
      // still carries the listing that started the whole thing.
      const backUrl = safeReturnPath(req.query.from, req.get('host'))
        || safeReturnPath(req.get('Referer'), req.get('host'));

      const contained = await Item.find({ parent: item._id }).lean();

      // And what holds this one, if anything: a season is absent from every listing, so
      // "back to the collection" would send its page nowhere useful. The show it belongs
      // to is the place to go back to.
      const holder: any = (item as any).parent
        ? await Item.findById((item as any).parent).select('title').lean()
        : null;

      const toProfile = (u: any) => u ? { username: u.username, img: u.img || '/ressources/no-pp.jpg' } : null;
      const [addedBy, modifiedBy] = await Promise.all([
        item.owner ? User.findById(item.owner).select('username img').lean() as any : null,
        (item as any).modified_by ? User.findById((item as any).modified_by).select('username img').lean() as any : null
      ]);

      res.render('detail', {
        item: formatted,
        plugin,
        variants: variants.map(v => plugin.formatForView(v)),
        addedBy: toProfile(addedBy),
        modifiedBy: toProfile(modifiedBy),
        contains: contained.map(c => plugin.formatForView(c)),
        holder: holder ? { _id: holder._id, title: holder.title } : null,
        backUrl,
        containsLabel: plugin.cardContains ? plugin.cardContains(item, contained) : null,
        user: res.locals.user
      });
    } catch (err: any) {
      console.error(`Detail page error for ${plugin.id}:`, err.message);
      res.status(500).send(req.t('errors.generic_server_error'));
    }
  });

  // DELETE /api/{prefix}/:id -> delete item
  router.delete(`/api${plugin.routePrefix}/:id`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
    try {
      const item = await Item.findOne({ _id: req.params.id, collection: res.locals.activeCollectionId });
      if (!item) {
        return res.status(404).json({ success: false, error: req.t('errors.not_found') });
      }
      // Takes the seasons of a show with it: they are only reachable from here.
      const deleted = await deleteItemsAndContents([item._id]);
      res.json({ success: true, deleted });
    } catch (err: any) {
      console.error(`Delete error for ${plugin.id}:`, err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/{prefix}/:id/refresh-info -> refresh metadata of single item
  if (plugin.refreshItem) {
    router.post(`/api${plugin.routePrefix}/:id/refresh-info`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      try {
        const item = await Item.findOne({ _id: req.params.id, collection: res.locals.activeCollectionId });
        if (!item) {
          return res.status(404).json({ success: false, error: "Item not found" });
        }

        const result = await plugin.refreshItem!(item, req);
        // Persist the refreshed metadata (some plugins already persist internally; this is
        // idempotent). The filter needs `kind` so Mongoose casts against the discriminator
        // schema; without it, plugin-only paths like tracklist are silently stripped by
        // strict mode.
        // Stamped even when the provider returned nothing new: the question the date
        // answers is when the metadata was last checked, not when it last changed.
        await Item.updateOne(
          { _id: item._id, kind: plugin.kind },
          { $set: { ...(result || {}), ...syncStamp() } }
        );
        res.json({ success: true, ...result });
      } catch (err: any) {
        console.error(`Refresh item error for ${plugin.id}:`, err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });
  }

  // POST /api/{prefix}/:id/move-to-collection -> move from wishlist to collection
  router.post(`/api${plugin.routePrefix}/:id/move-to-collection`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
    try {
      const stamp = editStamp(req.user._id);
      const moved = await Item.findOneAndUpdate(
        { _id: req.params.id, collection: res.locals.activeCollectionId },
        { in_wishlist: false, added_at: new Date(), ...stamp }
      );
      if (moved) await moveContentsToWishlist(moved._id, false, stamp);
      res.json({ success: true });
    } catch (err: any) {
      console.error(`Move to collection error for ${plugin.id}:`, err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/{prefix}/:id/move-to-wishlist -> send an owned item back to the wishlist
  // (sold, broken, added by mistake). Mirror of the route above, added_at included: both
  // lists sort on it, so the item lands where the move just happened rather than buried
  // at its old acquisition date.
  router.post(`/api${plugin.routePrefix}/:id/move-to-wishlist`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
    try {
      const stamp = editStamp(req.user._id);
      const moved = await Item.findOneAndUpdate(
        { _id: req.params.id, collection: res.locals.activeCollectionId },
        { in_wishlist: true, added_at: new Date(), ...stamp }
      );
      if (moved) await moveContentsToWishlist(moved._id, true, stamp);
      res.json({ success: true });
    } catch (err: any) {
      console.error(`Move to wishlist error for ${plugin.id}:`, err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
