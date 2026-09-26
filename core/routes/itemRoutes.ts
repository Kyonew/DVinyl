import express, { Router } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import { PluginDefinition } from '../types';
import Item from '../../models/Item';
import User from '../../models/User';
import { BASE_URL } from '../../config/constants';
import { requireAuth, requireAuthOrShareView, requireCollectionRole } from '../../middleware/authMiddleware';
import { parseGenresAndStyles, isBarcodeQuery, lookupBarcodeTitle, searchWithTitleFallback, editStamp, syncStamp, safeReturnPath, confirmPathFor, getPublicProtocol, generateBarcodeDataUrl, escapeRegExp } from '../helpers';
import { DEFAULT_PLACEHOLDER_IMAGE } from '../placeholderImage';
import { alignImagesAfterRefresh, imagesForItem, imagesFromForm, ItemImageValidationError, MAX_ITEM_IMAGES, MAX_ITEM_IMAGE_BYTES } from '../itemImages';
import { deleteUnusedManagedItemImages } from '../itemImageStorage';
import { getExtraFields, toFieldDefinitions } from '../pluginExtraFields';
import { buildFieldSuggestions } from '../fieldSuggestions';
import { resolveShelfLocation } from '../shelfStore';
import { deleteItemsAndContents, moveContentsToWishlist } from '../../utils/itemHelpers';
import { applyVisibilityFilter, applyShareScopeFilter, applyPluginKindFilter, isWithinShareScope } from '../../utils/visibilityHelper';
import { hasSearch, searchableSources, resolveSource, canRefresh, refreshPatchFor } from '../sources';

/**
 * Names what was just saved in the path an add comes back to, so the add page can say so.
 * It is the one place that needs telling: the collection listing shows the new item itself,
 * while the add page someone scanning is sent back to looks untouched otherwise.
 *
 * `qty` rides along only when the add landed on an item already there, which while working
 * through a stack is the thing worth noticing.
 */
function withAddedNotice(path: string, title: string, mergedQuantity: number | null): string {
  const [base, existingQuery] = path.split('?');
  const params = new URLSearchParams(existingQuery || '');
  params.set('added', title || '');
  if (mergedQuantity && mergedQuantity > 1) params.set('qty', String(mergedQuantity));
  return `${base}?${params.toString()}`;
}

// How long the search's go-ahead for a self-submitting confirm page stays valid: the
// redirect is followed at once, so anything slower is not that redirect.
const INSTANT_ADD_TTL_MS = 2 * 60 * 1000;

/**
 * Lets exactly one confirm page submit itself, the one this session's own search just
 * redirected to. A self-submitting page is an add nobody clicks, so reaching it has to take
 * more than a URL: without the token, any other site could send a signed-in user to a
 * confirm link asking for it and have the item added under their name.
 */
function issueInstantAddToken(req: any, pluginId: string): string {
  const token = crypto.randomBytes(16).toString('hex');
  if (req.session) req.session.instantAdd = { token, pluginId, expires: Date.now() + INSTANT_ADD_TTL_MS };
  return token;
}

/** True once per token issued above, for the plugin it was issued for. */
function consumeInstantAddToken(req: any, pluginId: string, token: unknown): boolean {
  const issued = req.session?.instantAdd;
  if (!issued || typeof token !== 'string' || !token) return false;
  delete req.session.instantAdd;
  return issued.token === token && issued.pluginId === pluginId && Date.now() <= issued.expires;
}

export function createItemRoutes(plugin: PluginDefinition): Router {
  const router = express.Router();

  // EXTERNAL SEARCH
  if (hasSearch(plugin)) {
    // GET /add-{type} -> render 'add' page
    router.get(`/add-${plugin.id}`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      try {
        const formatParam = req.query.format as string || req.query.type as string;
        res.render('add', {
          results: null,
          searchType: formatParam || plugin.id,
          // What the add this page was returned to saved (see withAddedNotice), since
          // nothing else on the page would show it.
          addedTitle: typeof req.query.added === 'string' ? req.query.added : '',
          addedQuantity: parseInt(String(req.query.qty || ''), 10) || 0,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          sources: searchableSources(plugin, res.locals.settings),
          activeSource: resolveSource(plugin, null, res.locals.settings)?.id || '',
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
      // The fields the plugin's own search form partial adds, as strings only. Every
      // render of the page below hands them back, so the partial shows them as picked.
      const searchFields: Record<string, string> = {};
      for (const name of plugin.searchFormFields || []) {
        const value = req.body[name];
        if (typeof value === 'string' && value.trim()) searchFields[name] = value.trim();
      }
      res.locals.searchFields = searchFields;
      // Which database to ask. The form only offers the picker when the plugin has more
      // than one configured, so most searches arrive without it and take the default.
      const source = resolveSource(plugin, req.body.source, res.locals.settings);
      const sources = searchableSources(plugin, res.locals.settings);
      let searchQuery = rawQuery;
      // A search run after a scan posts the code back (hidden field in add.ejs), so
      // correcting the product name by hand no longer detaches it from the saved item.
      const postedBarcode = String(req.body.scanned_barcode || '');
      let scannedBarcode = isBarcodeQuery(postedBarcode) ? postedBarcode.replace(/[- ]/g, '') : '';
      // Set only when this request resolved a barcode: the fallback below rewrites a
      // seller's product name, never what the user typed themselves.
      let resolvedTitle = '';
      // Scan mode, and a query the chosen source reads as one exact item (an ISBN for
      // Hardcover) rather than a description. However the search turns out the box goes
      // back empty, so the next scan does not type itself onto the end of this one.
      const exactIdentifier = res.locals.settings?.instantAdd === true
        && !!source?.exactQuery?.(rawQuery);
      // The same code, kept for the manual entry link: a provider that has never heard of
      // this ISBN is the usual reason to type a book in by hand, and the number is the one
      // field on that form nobody can look up. Stored without the hyphens it may have been
      // typed with, so it matches how an item added through a provider records its own.
      const identifierCode = exactIdentifier ? rawQuery.replace(/[- ]/g, '') : '';

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
              sources,
              activeSource: source?.id || '',
              plugin
            });
          }
          searchQuery = title;
          resolvedTitle = title;
        }

        const settings = res.locals.settings;
        if (!source) {
          // Every source the plugin declares is missing its credentials. Nothing to ask,
          // and nothing the user can do about it from here.
          return res.render('add', {
            results: [],
            error: req.t('errors.api_error', { provider: req.t(plugin.label) }),
            searchType: type || plugin.id,
            searchQuery: rawQuery,
            scanned_barcode: scannedBarcode,
            user: res.locals.user,
            currentType: `add-${plugin.id}`,
            sources,
            activeSource: '',
            plugin
          });
        }

        const runSearch = (q: string) => source.search(q, {
          ...searchFields,
          type: type || plugin.id,
          year,
          country,
          genre_filter,
          label_filter,
          language: req.language,
          // Pass the plugin's own settings so the provider stays the only one that knows its option keys
          pluginSettings: settings?.pluginSettings?.[plugin.id] || {}
        });

        let results;
        if (resolvedTitle) {
          const attempt = await searchWithTitleFallback(resolvedTitle, runSearch);
          results = attempt.results;
          searchQuery = attempt.query;
        } else {
          results = await runSearch(searchQuery);
        }

        // What the search box shows on the way back. After a scan the digits are useless
        // there: on a hit it is the query that actually matched, and on a miss the whole
        // product name, which is the thing the user has to correct. An identifier is
        // neither, and leaves the box empty: the code it stood for is named in the notice
        // below instead, which is the only place it is still worth reading.
        const boxQuery = exactIdentifier ? ''
          : resolvedTitle ? (results.length > 0 ? searchQuery : resolvedTitle)
          : rawQuery;

        // The id a result carries only means something next to the database that handed
        // it out, so it travels with it: the confirm link needs to ask the same source
        // for the details, and the item ends up storing the pair.
        for (const result of results) {
          result.source = source.id;
          result.confirmPath = confirmPathFor(plugin.id, result, { searchType: type, scannedBarcode });
        }

        // Scan mode: the query named one exact item and one thing came back, so there is
        // nothing to choose between. Straight to the confirm page, which submits itself.
        // Never after a barcode was resolved to a product name: that hit is a guess. The
        // path carries the source and the provider's confirmQuery like a result card does,
        // which is what makes the searched ISBN's edition the one saved.
        const onlyHit = results.length === 1 ? results[0] : undefined;
        if (exactIdentifier && !resolvedTitle && onlyHit?.confirmPath) {
          const path = onlyHit.confirmPath;
          const token = issueInstantAddToken(req, plugin.id);
          return res.redirect(`${path}${path.includes('?') ? '&' : '?'}instant=${token}`);
        }

        res.render('add', {
          results,
          // Nothing matched a product name the user never got to see: show it instead of
          // the digits so it can be corrected, the barcode rides along with the form. A
          // scanned identifier that found nothing has to say which one, the box it was
          // typed into having been emptied for the next item.
          error: results.length > 0 ? undefined
            : exactIdentifier ? req.t('add.identifier_no_match', { code: rawQuery })
            : resolvedTitle ? req.t('add_vinyl.barcode_no_match')
            : undefined,
          searchType: type || plugin.id,
          searchQuery: boxQuery,
          identifierCode,
          scanned_barcode: scannedBarcode,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          sources,
          activeSource: source.id,
          plugin
        });
      } catch (err: any) {
        console.error(`Search error for ${plugin.id}:`, err.message);
        res.render('add', {
          results: [],
          error: req.t('errors.api_error', { provider: source?.name || req.t(plugin.label) }),
          searchType: type || plugin.id,
          // Emptied here too: a provider that failed is a reason to scan the item again,
          // which needs the box clear as much as a miss does.
          searchQuery: exactIdentifier ? '' : rawQuery,
          identifierCode,
          scanned_barcode: scannedBarcode,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          sources,
          activeSource: source?.id || '',
          plugin
        });
      }
    });

    // GET /confirm-{type}/:id -> show details from external API before saving
    router.get(`/confirm-${plugin.id}/:id`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      const externalId = req.params.id;
      const searchTypeHint = req.query.type as string | undefined;
      // The id in the path was handed out by the source the result came from, carried
      // here by the result card. An unknown or dropped one falls back to the plugin's
      // default source, which is what every link predating this carries.
      const source = resolveSource(plugin, req.query.source as string | undefined, res.locals.settings);

      try {
        if (!source) throw new Error('no source configured');

        // The query string is forwarded whole rather than key by key: what a provider needs
        // to narrow a result down is its own business (TMDB asks which season), and the core
        // has no reason to learn the vocabulary of each one.
        const details = await source.getDetails(externalId, {
          ...req.query,
          type: searchTypeHint,
          language: req.language
        });

        // Where this item is about to come from. Written on the confirm form as a hidden
        // pair so the save handler stores it, which is what lets the item be traced back
        // to the right database later on.
        details.source = source.id;
        details.source_id = String(externalId);
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
          isManual: false,
          // Scan mode sends every add back to the add page, whether it submitted itself or
          // was finished by hand here; `instantAdd` is the search route saying this page was
          // reached by a scan that resolved to one exact item and needs no clicking, which
          // only its own one-time token can say.
          scanMode: res.locals.settings?.instantAdd === true,
          instantAdd: res.locals.settings?.instantAdd === true && consumeInstantAddToken(req, plugin.id, req.query.instant)
        });
      } catch (err: any) {
        console.error(`Details fetch error for ${plugin.id} ID ${externalId}:`, err.message);
        res.render('add', {
          results: [],
          error: `${req.t('errors.api_error', { provider: source?.name || req.t(plugin.label) })} (${err.message})`,
          searchType: searchTypeHint || plugin.id,
          user: res.locals.user,
          currentType: `add-${plugin.id}`,
          sources: searchableSources(plugin, res.locals.settings),
          activeSource: source?.id || '',
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

  /**
   * Keeps out of a list whatever the person looking is not meant to see: what the
   * collection hides from its viewers, and what a share link's scope leaves out. Both,
   * because a list built by a plugin knows neither. Costs one query, and none at all on
   * an empty list.
   */
  const filterVisible = async (items: any[], res: any): Promise<any[]> => {
    if (!items || items.length === 0) return items || [];

    const query: any = { _id: { $in: items.map((i: any) => i._id) } };
    applyVisibilityFilter(query, res.locals.isCollectionAdmin, res.locals.settings);
    if (res.locals.isShareView) {
      applyShareScopeFilter(query, res.locals.shareScope);
    }

    const allowed = new Set(
      (await Item.find(query).select('_id').lean()).map((i: any) => String(i._id))
    );
    return items.filter((i: any) => allowed.has(String(i._id)));
  };

  /**
   * Guards a route a share link is allowed to reach (`allowShareView`). The handler is
   * the plugin's, so the core checks what it is about to be asked for rather than what
   * it hands back: the item named by `:id`, against the link's scope and the collection
   * it belongs to. A route without that parameter tells the core nothing it can check,
   * so a share visitor is turned away instead of trusted.
   *
   * Members go straight through; this costs a query to nobody but a share visitor.
   */
  const shareScopeGuard = async (req: any, res: any, next: any) => {
    if (!res.locals.isShareView) return next();

    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).send(req.t('errors.not_found'));
    }
    // Reached only by a share visitor, for whom the wishlist does not exist: the listing
    // that would show it is behind a login, and its page has to say the same.
    const guardQuery: any = { _id: id, collection: res.locals.activeCollectionId, in_wishlist: false };
    applyPluginKindFilter(guardQuery, plugin);
    applyVisibilityFilter(guardQuery, res.locals.isCollectionAdmin, res.locals.settings);
    const item = await Item.findOne(guardQuery).lean();
    if (!item || !await isWithinShareScope(res, item)) {
      return res.status(404).send(req.t('errors.not_found'));
    }
    next();
  };

  // PLUGIN API ROUTES (e.g. Discogs estimate for music)
  for (const apiRouteDef of plugin.apiRoutes || []) {
    const middlewares = apiRouteDef.requireAdmin
      ? [requireAuth, requireCollectionRole('admin')]
      : apiRouteDef.requireEditor
        ? [requireAuth, requireCollectionRole('editor')]
        : apiRouteDef.allowShareView
          ? [requireAuthOrShareView, shareScopeGuard]
          : [requireAuth];
    (router as any)[apiRouteDef.method](apiRouteDef.path, ...middlewares, (req: any, res: any) => apiRouteDef.handler(req, res));
  }

  // MANUAL ADD ENTRY
  if (plugin.getManualDefaults) {
    router.get(`/add-${plugin.id}/manual`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      try {
        const defaults = plugin.getManualDefaults!();
        const activeCollectionId = res.locals.activeCollectionId;

        // Handed over by the add page when a code found nothing there: the book is still in
        // someone's hand and its number is the one field on this form that cannot be looked
        // up, so it is filled in rather than read off the cover a second time. Ordinary form
        // input from here on, free to be corrected or cleared like anything else.
        if (typeof req.query.barcode === 'string' && req.query.barcode) {
          defaults.barcode = req.query.barcode;
        }

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
          isManual: true,
          // Typed in by hand rather than scanned, so nothing submits itself here; what scan
          // mode still owes this form is landing back on the add page afterwards.
          scanMode: res.locals.settings?.instantAdd === true,
          instantAdd: false
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
      // Where an add goes next when the form asks for somewhere other than the collection:
      // the add page it came from, in scan mode. Validated like any other path handed over
      // by a form, and left out of the wishlist and edit cases, which have their own
      // destination and did not come from a scan.
      const afterAdd = safeReturnPath(req.body.after_add, req.get('host'));
      const isBarcodeLocked = barcode_locked === 'on' || barcode_locked === 'true' || barcode_locked === true;

      const { genres: parsedGenres, styles: parsedStyles } = parseGenresAndStyles(genres, styles);

      // A cover left untouched posts back whatever the form displayed, i.e. the resolved
      // placeholder. Storing it would freeze a copy of the plugin's default image on the
      // item; kept empty instead, so the item follows that default if it ever changes.
      const placeholder = plugin.placeholderImage || DEFAULT_PLACEHOLDER_IMAGE;
      const submittedImages = imagesFromForm(req.body).filter(image =>
        image !== placeholder && image !== DEFAULT_PLACEHOLDER_IMAGE
      );
      const coverImage = submittedImages[0] || '';
      const secondaryImage = submittedImages[1] || '';

      // Build updateData generic object
      const updateData: any = {
        title,
        year,
        cover_image: coverImage,
        user_image: secondaryImage,
        images: submittedImages,
        in_wishlist: isWishlist,
        comments: comments || '',
        // Never the raw form value: the store is what turns it into the one spelling
        // the collection uses, and what creates the shelf when the picker invented one.
        location: await resolveShelfLocation(activeCollectionId, location),
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
          'title', 'year', 'cover_image', 'user_image', 'images', 'in_wishlist', 'comments',
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

      // Which database this save came from. Not a plugin schema path (every item carries
      // the pair, whatever its plugin), so the loop above does not pick it up. Taken only
      // when the form actually posts it: a manual add posts neither, and must not blank
      // the reference an earlier lookup wrote.
      if (req.body.source && req.body.source_id) {
        updateData.source = String(req.body.source);
        updateData.source_id = String(req.body.source_id);
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
          try {
            await deleteUnusedManagedItemImages(submittedImages);
          } catch (cleanupError) {
            console.warn('[ITEM IMAGE] Post-create cleanup failed:', cleanupError);
          }
          if (isWishlist) return res.redirect('/wishlist');
          return res.redirect(afterAdd
            ? withAddedNotice(afterAdd, updateData.title, null)
            : `/collection?type=${plugin.collectionType}`);
        }
      }

      let existingItem: any;
      let isEdit = false;
      // Set only when this add landed on an item that was already there, whose quantity it
      // bumped: the number the add page reports back.
      let mergedQuantity: number | null = null;

      if (mongo_id) {
        // Scope the edit to the active collection so a stale mongo_id (e.g. from a
        // form left open after switching collections) can't target another item. A
        // miss here must fail outright, not fall through to the duplicate-match
        // branch below and silently overwrite an unrelated item.
        const editQuery: any = { _id: mongo_id, collection: activeCollectionId };
        applyPluginKindFilter(editQuery, plugin);
        existingItem = await Item.findOne(editQuery);
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
        if (!isEdit) mergedQuantity = finalQty;

        let saveObj: any;
        const unsetObj: Record<string, ''> = {};
        if (isEdit) {
          saveObj = { ...updateData, quantity: finalQty };
          // Do not reset the added date when editing an existing item
          if (!added_at) {
            saveObj.added_at = existingItem.added_at || new Date();
          }

          // An emptied input now clears the stored value instead of being ignored, which
          // is the only way to detach a wrong external id (a CSV import matching the
          // wrong Discogs release) or to blank a number field. Written as $unset rather
          // than $set: a Number path would reject the empty string it is posted as.
          //
          // Eligible: a path the form posted back blank, and that nothing above already
          // resolved. A key absent from the body means the form does not carry that path
          // at all, not that the owner emptied it, so it stays untouched: tracklist comes
          // back as `tracklist_json`, episodes never come back, and unsetting either
          // would wipe the ratings and notes the owner attached to them.
          for (const fieldName of Object.keys(plugin.schemaDefinition)) {
            const postedValue = req.body[fieldName];
            const isBlank = typeof postedValue === 'string' && postedValue.trim() === '';
            const alreadyResolved = saveObj[fieldName] !== undefined;
            const storedValue = existingItem[fieldName];
            const hasStoredValue = storedValue !== undefined && storedValue !== null && storedValue !== '';
            if (isBlank && !alreadyResolved && hasStoredValue) {
              unsetObj[fieldName] = '';
              delete saveObj[fieldName];
            }
          }

          // Detaching the external id detaches the record it pointed at. refreshPatchFor()
          // prefers the stored source pair over the plugin's own id field, so leaving the
          // pair behind would keep refreshing the item from the very match its owner just
          // rejected, which is what emptying the id is for. Skipped when the form posts a
          // pair of its own, which is a re-attachment rather than a detachment.
          const detachedIdField = plugin.externalIdField;
          if (detachedIdField && unsetObj[detachedIdField] !== undefined && !saveObj.source_id) {
            if (existingItem.source) unsetObj.source = '';
            if (existingItem.source_id) unsetObj.source_id = '';
            delete saveObj.source;
            delete saveObj.source_id;
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

          // The source pair is backfilled as one value: half of it says nothing, and a
          // stored id belongs to whichever database handed it out. Left alone as soon as
          // the existing item already names a source, even a different one, since that is
          // where its metadata came from and where a refresh has to go looking.
          if (updateData.source && updateData.source_id && !existingItem.source) {
            saveObj.source = updateData.source;
            saveObj.source_id = updateData.source_id;
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
        const updateDoc: any = { $set: { ...saveObj, ...editStamp(adminId) } };
        if (Object.keys(unsetObj).length > 0) {
          updateDoc.$unset = unsetObj;
        }
        await EditModel.updateOne(
          { _id: existingItem._id },
          updateDoc,
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

      try {
        await deleteUnusedManagedItemImages([
          ...submittedImages,
          ...(existingItem ? imagesForItem(existingItem) : [])
        ]);
      } catch (cleanupError) {
        console.warn('[ITEM IMAGE] Post-save cleanup failed:', cleanupError);
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
      } else if (afterAdd) {
        // Scan mode: back to the add page, which is where the next item is going in, with
        // what just landed named in the query string since this page shows no list.
        res.redirect(withAddedNotice(afterAdd, updateData.title, mergedQuantity));
      } else {
        res.redirect(`/collection?type=${plugin.collectionType}`);
      }
    } catch (err: any) {
      if (err instanceof ItemImageValidationError) {
        const key = err.code === 'too_many' ? 'image_manager.too_many' : 'image_manager.too_large';
        return res.status(400).send(req.t(key, {
          max: MAX_ITEM_IMAGES,
          maxMb: Math.floor(MAX_ITEM_IMAGE_BYTES / (1024 * 1024))
        }));
      }
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
      const editFormQuery: any = { _id: req.params.id, collection: activeCollectionId };
      applyPluginKindFilter(editFormQuery, plugin);
      const item = await Item.findOne(editFormQuery);
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
  router.get(`${plugin.routePrefix}/:id`, requireAuthOrShareView, async (req: any, res: any) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).send(req.t('errors.not_found'));
      }
      // An item the collection hides from its viewers is hidden from its page too, not just
      // from the grid: the id is the only thing standing between the two, and a share link
      // hands it to whoever wants to try one.
      const detailQuery: any = { _id: req.params.id, collection: res.locals.activeCollectionId };
      applyPluginKindFilter(detailQuery, plugin);
      applyVisibilityFilter(detailQuery, res.locals.isCollectionAdmin, res.locals.settings);
      // What someone merely wants is not part of what a public link was opened to show,
      // and every listing a share visitor can reach already says so.
      if (res.locals.isShareView) detailQuery.in_wishlist = false;

      const item = await Item.findOne(detailQuery);
      if (!item) {
        return res.status(404).send(req.t('errors.not_found'));
      }

      // A scoped share link must not leak an out-of-scope item by URL-guessing its id,
      // even though the collection listing itself already excludes it from the query.
      if (!await isWithinShareScope(res, item)) {
        return res.status(404).send(req.t('errors.not_found'));
      }

      const formatted = plugin.formatForView(item);

      // A plugin looks its other editions up by what they are (same title and artist, same
      // set number), which it can do without knowing who is asking. Whether one of them is
      // hidden is the collection's business, not the plugin's, so it is settled here rather
      // than by handing every plugin a viewer to reason about.
      const variants = await filterVisible(await plugin.getVariants(formatted), res);

      // Who put the item there. Read separately rather than populated, so formatForView
      // keeps receiving the raw document it expects. A member removed since then leaves
      // a dangling reference, which simply reads as unknown.
      // What this item holds, if anything: the seasons of a show. Kept out of every
      // listing, so this page is the only way to them, which is also why deleting the
      // holder takes them along.
      const containedQuery: any = { parent: item._id };
      applyVisibilityFilter(containedQuery, res.locals.isCollectionAdmin, res.locals.settings);
      const contained = await Item.find(containedQuery).lean();

      // Where this page was opened from, so leaving it, editing or deleting comes back to
      // the very page someone was on rather than the first one. The explicit parameter
      // wins: after saving an edit the header points at the form, while the parameter
      // still carries the listing that started the whole thing.
      //
      // The Referer fallback must not be another item detail page. This page links to
      // several of its own kind - the seasons it holds, the other formats/variants listed
      // at the bottom - none of which carry a ?from origin, so following one lands here
      // with that page as the Referer. Trusting it makes "back to collection" point at the
      // sibling just left, and since that page's own back points here in turn, the two
      // trap each other in a loop with no way out but Home. A detail page is never a
      // listing anyway, so it is not a place "back" should ever lead.
      //
      // A detail page reads as `<BASE_URL><routePrefix>/<24-hex-id>`; its listings live at
      // other paths. When the Referer is one of those detail pages there is nothing left
      // to trust, and the view falls through to the canonical collection URL it builds.
      // safeReturnPath keeps BASE_URL on the path it returns, so the pattern allows the
      // optional base prefix before the plugin's route (an instance served under a sub-path).
      const refererPath = safeReturnPath(req.get('Referer'), req.get('host'));
      const detailPagePattern = new RegExp(
        `^${escapeRegExp(BASE_URL)}${escapeRegExp(plugin.routePrefix)}/[a-f0-9]{24}(?:$|[?#])`,
        'i'
      );
      const refererIsDetailPage = !!refererPath && detailPagePattern.test(refererPath);
      const backUrl = safeReturnPath(req.query.from, req.get('host'))
        || (refererIsDetailPage ? '' : refererPath);

      // And what holds this one, if anything: a season is absent from every listing, so
      // "back to the collection" would send its page nowhere useful. The show it belongs
      // to is the place to go back to.
      const holderQuery: any = { _id: (item as any).parent };
      applyVisibilityFilter(holderQuery, res.locals.isCollectionAdmin, res.locals.settings);
      const holder: any = (item as any).parent
        ? await Item.findOne(holderQuery).select('title').lean()
        : null;

      // Who put the item there and who last touched it, for the people who share the
      // collection. A public link says nothing about them: it was opened to show a shelf,
      // not to name the household behind it, so the lookups do not even run.
      const toProfile = (u: any) => u ? { username: u.username, img: u.img || '/ressources/no-pp.jpg' } : null;
      const [addedBy, modifiedBy] = res.locals.isShareView ? [null, null] : await Promise.all([
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

  // GET /{prefix}/:id/label -> printable label, either a QR code linking back to the
  // item's detail page or a barcode of its stored barcode value. ?type=barcode picks
  // the barcode; anything else (including a missing/unavailable barcode) falls back
  // to QR, so the two never render on the same label at once.
  router.get(`${plugin.routePrefix}/:id/label`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).send(req.t('errors.not_found'));
      }

      const labelQuery: any = { _id: req.params.id, collection: res.locals.activeCollectionId };
      applyPluginKindFilter(labelQuery, plugin);
      applyVisibilityFilter(labelQuery, res.locals.isCollectionAdmin, res.locals.settings);

      const item = await Item.findOne(labelQuery);
      if (!item) {
        return res.status(404).send(req.t('errors.not_found'));
      }

      let codeType: 'qr' | 'barcode' = 'qr';
      let codeDataUrl: string | null = null;
      // Trimmed: a field holding only spaces encodes into a valid but meaningless
      // symbol, and must not offer the barcode choice either.
      const barcodeValue = (item.barcode || '').trim();

      if (req.query.type === 'barcode' && barcodeValue) {
        codeDataUrl = await generateBarcodeDataUrl(barcodeValue);
        if (codeDataUrl) codeType = 'barcode';
      }

      if (!codeDataUrl) {
        const url = `${getPublicProtocol(req)}://${req.get('host')}${BASE_URL}${plugin.routePrefix}/${item._id}`;
        codeDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
        codeType = 'qr';
      }

      res.render('label', {
        item: plugin.formatForView(item),
        plugin,
        codeType,
        codeDataUrl,
        hasBarcode: !!barcodeValue,
        user: res.locals.user
      });
    } catch (err: any) {
      console.error(`Label error for ${plugin.id}:`, err.message);
      res.status(500).send(req.t('errors.generic_server_error'));
    }
  });

  // DELETE /api/{prefix}/:id -> delete item
  router.delete(`/api${plugin.routePrefix}/:id`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
    try {
      const deleteQuery: any = { _id: req.params.id, collection: res.locals.activeCollectionId };
      applyPluginKindFilter(deleteQuery, plugin);
      const item = await Item.findOne(deleteQuery);
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
  if (canRefresh(plugin)) {
    router.post(`/api${plugin.routePrefix}/:id/refresh-info`, requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
      try {
        const refreshQuery: any = { _id: req.params.id, collection: res.locals.activeCollectionId };
        applyPluginKindFilter(refreshQuery, plugin);
        const item = await Item.findOne(refreshQuery);
        if (!item) {
          return res.status(404).json({ success: false, error: "Item not found" });
        }

        // Through the item's own source where the plugin can merge one, so an item that
        // came from somewhere other than the plugin's historical provider refreshes
        // against the database that actually holds it.
        const result = await refreshPatchFor(plugin, item, req);
        // Persist the refreshed metadata (some plugins already persist internally; this is
        // idempotent). The filter needs `kind` so Mongoose casts against the discriminator
        // schema; without it, plugin-only paths like tracklist are silently stripped by
        // strict mode.
        // Stamped even when the provider returned nothing new: the question the date
        // answers is when the metadata was last checked, not when it last changed.
        const update = { ...(result || {}) };
        const replacedCover = alignImagesAfterRefresh(item, update);
        await Item.updateOne(
          { _id: item._id, kind: plugin.kind },
          { $set: { ...update, ...syncStamp() } }
        );
        if (replacedCover) {
          try {
            await deleteUnusedManagedItemImages([replacedCover]);
          } catch (cleanupError) {
            console.warn('[ITEM IMAGE] Post-refresh cleanup failed:', cleanupError);
          }
        }
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
      const moveQuery: any = { _id: req.params.id, collection: res.locals.activeCollectionId };
      applyPluginKindFilter(moveQuery, plugin);
      const moved = await Item.findOneAndUpdate(
        moveQuery,
        { in_wishlist: false, added_at: new Date(), ...stamp }
      );
      // A miss means the id is not this plugin's to move (or not in this collection).
      // Saying "success" there would tell the page a move happened that never did.
      if (!moved) {
        return res.status(404).json({ success: false, error: req.t('errors.not_found') });
      }
      await moveContentsToWishlist(moved._id, false, stamp);
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
      const moveQuery: any = { _id: req.params.id, collection: res.locals.activeCollectionId };
      applyPluginKindFilter(moveQuery, plugin);
      const moved = await Item.findOneAndUpdate(
        moveQuery,
        { in_wishlist: true, added_at: new Date(), ...stamp }
      );
      // A miss means the id is not this plugin's to move (or not in this collection).
      // Saying "success" there would tell the page a move happened that never did.
      if (!moved) {
        return res.status(404).json({ success: false, error: req.t('errors.not_found') });
      }
      await moveContentsToWishlist(moved._id, true, stamp);
      res.json({ success: true });
    } catch (err: any) {
      console.error(`Move to wishlist error for ${plugin.id}:`, err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
