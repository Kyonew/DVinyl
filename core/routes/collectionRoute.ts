import express from 'express';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import { registry } from '../registry';
import { viewRegistry } from '../viewRegistry';
import { CollectionViewContext } from '../types';
import Item from '../../models/Item';
import Collection from '../../models/Collection';
import User from '../../models/User';
import { BASE_URL } from '../../config/constants';
import { requireAuth, requireAuthOrShareView, requireCollectionRole } from '../../middleware/authMiddleware';
import { applyVisibilityFilter, applyEnabledModulesFilter, applyContainedFilter, applyShareScopeFilter } from '../../utils/visibilityHelper';
import { escapeRegExp, getPublicProtocol, generateBarcodeDataUrl } from '../helpers';
import { generateUniqueSlug } from '../../utils/collectionHelpers';
import { resolveShelfItems } from '../../utils/itemHelpers';
import { checkCollectionCreation } from '../../utils/instanceSettings';
import {
  getExtraFields, buildExtraFieldConditions, parseExtraSort, extraSortKey,
  filterParam, isFilterable, isRangeFilter, isPickerFilter, EXTRA_ANY, EXTRA_NONE
} from '../pluginExtraFields';

const router = express.Router();

router.get('/wishlist', requireAuth, async (req: any, res: any) => {
  const data = await buildShelfView(req, res, true);
  if (data) res.render('wishlist', data);
});

router.get('/collection', requireAuthOrShareView, async (req: any, res: any) => {
  const data = await buildShelfView(req, res, false);
  if (data) res.render('collection', data);
});

// The collection and the wishlist are the same page over two halves of the same
// shelf, so they share everything below and differ only on `inWishlist`.
// Returns null once it has answered on its own (no collection to show, or a
// failure): the caller must not render on top of a response already sent.
async function buildShelfView(req: any, res: any, inWishlist: boolean): Promise<Record<string, any> | null> {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      res.render('no-collection', { user: res.locals.user, msgKey: req.query.msg });
      return null;
    }
    const settings = res.locals.settings;
    const { search, type, format, location, genre, style, platform, artist, decade } = req.query;

    const trimmedSearch = typeof search === 'string' ? search.trim() : '';
    const trimmedArtist = typeof artist === 'string' ? artist.trim() : '';

    let sort = req.query.sort;
    if (sort) {
      res.cookie('sortPref', sort, { maxAge: 365 * 24 * 60 * 60 * 1000 });
    } else {
      sort = (req.cookies.sortPref as string) || 'added_desc';
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    // Remembered per browser like the sort above, rather than stored on the collection:
    // how many items fit on a screen is a property of who is looking, not of what is
    // shared between members. Clamped before it is stored, so a crafted value cannot
    // come back from the cookie on every later request.
    const clampLimit = (value: any) => Math.min(200, Math.max(1, parseInt(value) || 25));
    let limit;
    if (req.query.limit) {
      limit = clampLimit(req.query.limit);
      res.cookie('limitPref', String(limit), { maxAge: 365 * 24 * 60 * 60 * 1000 });
    } else {
      limit = clampLimit(req.cookies.limitPref);
    }

    // How the page is drawn, remembered per browser like the two above. Resolved
    // through the registry before it is stored, so an id that does not exist, or one
    // that no longer applies to this page, cannot come back from the cookie on every
    // later request.
    const viewContext: CollectionViewContext = { req, res, inWishlist };
    const activeView = viewRegistry.resolve(req.query.view || req.cookies.viewPref, viewContext);
    if (req.query.view === activeView.id) {
      res.cookie('viewPref', activeView.id, { maxAge: 365 * 24 * 60 * 60 * 1000 });
    }

    let query: any = { collection: activeCollectionId, in_wishlist: inWishlist };
    // Two separate buckets. `conditions` holds the user's criteria, which filterMode
    // 'hide' inverts. `scopeConditions` holds what defines *which items the page is
    // about at all* (the selected type): inverting that would widen the page to other
    // types instead of narrowing it, so it is always ANDed as-is.
    let conditions: any[] = [];
    let scopeConditions: any[] = [];

    // A scoped share link only ever browses the types it allowlists - narrow the
    // plugin list up front so search fields, the type/format filters and the
    // artist/genre/style lookups below all follow suit automatically.
    const shareScope = res.locals.isShareView ? (res.locals.shareScope || []) : [];
    const shareScopedPluginIds = shareScope.length > 0
      ? new Set(shareScope.map((s: any) => s.pluginId))
      : null;
    const enabledPlugins = shareScopedPluginIds
      ? registry.getEnabled(settings).filter(p => shareScopedPluginIds.has(p.id))
      : registry.getEnabled(settings);

    // SEARCH QUERY
    if (trimmedSearch) {
      const regex = new RegExp(escapeRegExp(trimmedSearch), 'i');
      const searchOr: any[] = [
        { title: regex },
        { barcode: regex }
      ];

      for (const plugin of enabledPlugins) {
        searchOr.push({ [plugin.creatorField]: regex });
        if (plugin.extraSearchFields) {
          for (const extra of plugin.extraSearchFields) {
            searchOr.push({ [extra]: regex });
          }
        }
      }

      if (mongoose.Types.ObjectId.isValid(trimmedSearch)) {
        searchOr.push({ _id: trimmedSearch });
      }
      conditions.push({ $or: searchOr });
    }

    // TYPE / PLUGIN MODULE FILTER
    if (type && type !== 'all') {
      const plugin = enabledPlugins.find(p => p.id === type);
      if (plugin) {
        if (plugin.matchesLegacyItems) {
          // Compatibility with older DB where kind was absent (pre-plugins era).
          // Needs an $or, so it cannot live on query.kind like the other plugins do,
          // hence the scope bucket rather than a plain query field.
          scopeConditions.push({
            $or: [{ kind: plugin.kind }, { kind: { $exists: false } }]
          });
        } else {
          query.kind = plugin.kind;
        }
      }
    }

    // FORMAT FILTER
    if (format && format !== 'all') {
      const formatRegex = new RegExp(`^${escapeRegExp(format)}$`, 'i');
      conditions.push({
        $or: [{ media_type: formatRegex }, { format: formatRegex }]
      });
    }

    // LOCATION FILTER
    // Never for a share link: where things are kept is not part of what is being shown
    // (see SHARE_HIDDEN_FIELDS), and a filter left open would let a visitor confirm a
    // shelf name by trying it, which is the same disclosure the hidden control avoids.
    if (location && !res.locals.isShareView) {
      conditions.push({ location: new RegExp(escapeRegExp(location), 'i') });
    }

    // ARTIST / CREATOR FILTER
    if (trimmedArtist) {
      const artistRegex = new RegExp(escapeRegExp(trimmedArtist), 'i');
      const fields = new Set<string>();

      for (const plugin of enabledPlugins) {
        fields.add(plugin.creatorField);
        for (const f of plugin.creatorSearchFields || []) fields.add(f);
      }

      const artistOr = Array.from(fields).map(f => ({ [f]: artistRegex }));
      conditions.push({ $or: artistOr });
    }

    // GENRE FILTER
    if (genre) {
      const genreArr = genre.split(',').map((g: string) => g.trim()).filter(Boolean);
      if (genreArr.length > 0) {
        conditions.push({
          $or: [
            { genre: { $in: genreArr.map((g: string) => new RegExp(escapeRegExp(g), 'i')) } },
            { genres: { $in: genreArr.map((g: string) => new RegExp(escapeRegExp(g), 'i')) } }
          ]
        });
      }
    }

    // STYLE FILTER
    if (style) {
      const styleArr = style.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (styleArr.length > 0) {
        conditions.push({
          styles: { $in: styleArr.map((s: string) => new RegExp(escapeRegExp(s), 'i')) }
        });
      }
    }

    // PLATFORM FILTER
    if (platform) {
      const platformArr = platform.split(',').map((p: string) => p.trim()).filter(Boolean);
      if (platformArr.length > 0) {
        conditions.push({
          platform: { $in: platformArr.map((p: string) => new RegExp(`^${escapeRegExp(p)}$`, 'i')) }
        });
      }
    }

    // DECADE FILTER
    if (decade) {
      const decadeArr = decade.split(',').map((d: string) => parseInt(d)).filter((d: number) => !isNaN(d));
      if (decadeArr.length > 0) {
        const years: RegExp[] = [];
        decadeArr.forEach((startYear: number) => {
          for (let y = startYear; y < startYear + 10; y++) {
            years.push(new RegExp(`^${y}$`));
          }
        });
        conditions.push({ year: { $in: years } });
      }
    }

    // USER-DEFINED FIELD FILTERS
    // Scoped to a selected type: the fields are declared per plugin, so they are
    // meaningless while the collection shows every type at once.
    const selectedPlugin = (type && type !== 'all')
      ? enabledPlugins.find(p => p.id === type)
      : undefined;
    const extraDefs = selectedPlugin ? getExtraFields(settings, selectedPlugin.id) : [];
    conditions.push(...buildExtraFieldConditions(extraDefs, req.query));

    // Scope shared by every "values actually in use" lookup feeding the filter controls.
    // Without a selected type the page spans them all, so the lookup stays unscoped.
    //
    // A share link narrows it the same way it narrows the grid. The values offered by a
    // filter come from items, and a lookup left wide open would name what the link keeps
    // from its visitor: asking for a type the link excludes lands here with no selected
    // plugin, which used to mean "every type" and now means "every type this link shows".
    const typeScope = (): any => {
      const base: any = { collection: activeCollectionId };
      applyShareScopeFilter(base, shareScope);
      if (!selectedPlugin) return base;
      return selectedPlugin.matchesLegacyItems
        ? { ...base, $or: [{ kind: selectedPlugin.kind }, { kind: { $exists: false } }] }
        : { ...base, kind: selectedPlugin.kind };
    };

    const filterMode = (req.query.filterMode as string) || 'show';
    // 'hide' negates the criteria as a block ("everything except what matches"), then
    // the scope is re-applied on top so the exclusion stays inside the selected type.
    const criteria = conditions.length === 0 ? []
      : filterMode === 'hide' ? [{ $nor: [{ $and: conditions }] }]
        : conditions;
    const allConditions = [...scopeConditions, ...criteria];
    if (allConditions.length > 0) {
      query.$and = allConditions;
    }

    applyVisibilityFilter(query, res.locals.isCollectionAdmin, settings);
    applyEnabledModulesFilter(query, settings);
    applyContainedFilter(query);
    if (res.locals.isShareView) {
      applyShareScopeFilter(query, shareScope);
    }

    const totalItems = await Item.countDocuments(query);

    // BUILD SORT OBJECT
    const buildSortObj = () => {
      const extraSort = parseExtraSort(sort as string, extraDefs);
      if (extraSort) return extraSort;

      const sortMap: Record<string, any> = {
        'added_desc': { added_at: -1 },
        'added_asc': { added_at: 1 },
        // `title` stays as a tie-breaker: two items whose sort keys are equal ("The Wall"
        // and "Wall") would otherwise come back in whatever order Mongo felt like.
        'title_asc': { sort_title: 1, title: 1 },
        'title_desc': { sort_title: -1, title: -1 },
        'year_desc': { year: -1 },
        'year_asc': { year: 1 },
      };

      if (sort && sort.startsWith('artist')) {
        const dir = sort === 'artist_asc' ? 1 : -1;
        // No single creator field spans every type, so "all" falls back to the title, and
        // it sorts on the same normalized key as the title options above.
        if (!type || type === 'all') return { sort_title: dir, title: dir };

        const plugin = enabledPlugins.find(p => p.id === type);
        const field = plugin ? plugin.creatorField : 'title';
        return { [field]: dir };
      }

      return sortMap[sort || ''] || { added_at: -1 };
    };

    const found = await Item.find(query)
      .sort(buildSortObj())
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // A holder stands in for what it holds: several seasons and the show says so on its
    // card, a single one and that season takes the place outright. Applied after the
    // query, so a show still sorts and paginates on its own title.
    const albums = await resolveShelfItems(found, res);

    // DYNAMIC FILTER MAP FROM REGISTRY
    // Read off the decorated registry, not the bare one: the collection's own
    // customization lives there, and the format order it may carry has to reach the
    // filter bar the same way it reaches the form select.
    const filterMap: Record<string, { id: string; label: string }[]> = {};
    for (const plugin of enabledPlugins) {
      const customized = res.locals.registry.get(plugin.id) || plugin;
      const scopedFormats: string[] | null = shareScopedPluginIds
        ? (shareScope.find((s: any) => s.pluginId === plugin.id)?.formats || [])
        : null;
      const allowedFormats = scopedFormats && scopedFormats.length > 0 ? new Set(scopedFormats) : null;
      filterMap[plugin.id] = customized.formats
        .filter((f: any) => !allowedFormats || allowedFormats.has(f.value))
        .map((f: any) => ({
          id: f.value,
          label: req.t(f.label)
        }));
    }

    // DYNAMIC ARTIST LIST
    const artistList = await (async () => {
      const baseQuery: any = { collection: activeCollectionId, in_wishlist: inWishlist };
      // Per-plugin below, which a link scoped to a whole type already covers; this is for
      // the one scoped to some of its formats, where the kind alone would still offer the
      // names behind the formats it left out.
      applyShareScopeFilter(baseQuery, shareScope);
      if (!type || type === 'all') {
        const promises = enabledPlugins.map(plugin =>
          Item.distinct(plugin.creatorField, { ...baseQuery, [plugin.creatorField]: { $nin: ['', null] } })
        );
        const results = await Promise.all(promises);
        const merged = results.flat();
        return [...new Set(merged)].filter(Boolean).sort();
      } else {
        const plugin = enabledPlugins.find(p => p.id === type);
        if (!plugin) return [];
        const typeQuery = plugin.matchesLegacyItems
          ? { ...baseQuery, $or: [{ kind: plugin.kind }, { kind: { $exists: false } }] }
          : { ...baseQuery, kind: plugin.kind };
        return (await Item.distinct(plugin.creatorField, { ...typeQuery, [plugin.creatorField]: { $nin: ['', null] } })).sort();
      }
    })();

    const albumsFormatted = albums.map(item => {
      const plugin = registry.getByKind(item.kind as any);
      return plugin ? plugin.formatForView(item) : item;
    });

    // Where things are kept spans every type, so this one is not scoped by the selected
    // type. A share link gets none of it: the control is not drawn for a visitor, and the
    // values that would fill it are not read either.
    const locationQuery: any = { collection: activeCollectionId, location: { $nin: ['', null] } };
    const locations = res.locals.isShareView ? [] : await Item.distinct('location', locationQuery);

    // Scoped to the selected type, so a type never offers another type's values (and the
    // view drops a control entirely once its list comes back empty).
    const genresList = await Promise.all([
      Item.distinct('genres', { ...typeScope(), genres: { $nin: ['', null] } }),
      Item.distinct('genre', { ...typeScope(), genre: { $nin: ['', null] } })
    ]);
    const genres = [...new Set(genresList.flat())].filter(Boolean).sort();

    const styles = await Item.distinct('styles', { ...typeScope(), styles: { $nin: ['', null] } });
    styles.sort();

    const platforms = await Item.distinct('platform', { ...typeScope(), platform: { $nin: ['', null, 'other'] } });
    platforms.sort();

    // The decade filter only makes sense where something actually carries a year
    const hasYear = !!(await Item.exists({ ...typeScope(), year: { $nin: ['', null] } }));

    // Filter and sort labels follow the selected type's own wording ("Fabricant",
    // "Réalisateur"...) instead of the music-flavoured default.
    const creatorDef = selectedPlugin
      ? selectedPlugin.formFields.find(f => f.name === selectedPlugin.creatorField)
      : undefined;
    const creatorFilterLabel = creatorDef
      ? req.t(creatorDef.label, { defaultValue: creatorDef.label })
      : '';

    // Filter controls for the selected type's user-defined fields. Picker filters offer
    // the values actually stored (a select uses its declared options instead, so an
    // option nobody used yet is still selectable and shows its label).
    const extraFilters = await Promise.all(
      extraDefs.filter(isFilterable).map(async (field) => {
        const control = {
          name: field.name,
          label: field.label,
          type: field.type,
          kind: isRangeFilter(field) ? 'range' : (field.type === 'boolean' ? 'boolean' : 'picker'),
          param: filterParam(field),
          paramFrom: filterParam(field, 'from'),
          paramTo: filterParam(field, 'to'),
          sortKey: extraSortKey(field),
          value: (req.query[filterParam(field)] as string) || '',
          from: (req.query[filterParam(field, 'from')] as string) || '',
          to: (req.query[filterParam(field, 'to')] as string) || '',
          choices: [] as { value: string; label: string }[]
        };

        if (field.type === 'select') {
          control.choices = (field.options || []).map(o => ({ value: o.value, label: o.label }));
        } else if (isPickerFilter(field)) {
          const values = await Item.distinct(`extra.${field.name}`, {
            ...typeScope(),
            [`extra.${field.name}`]: { $nin: ['', null] }
          });
          control.choices = values
            .filter((v: any) => typeof v === 'string' || typeof v === 'number')
            .map((v: any) => String(v))
            .sort()
            .slice(0, 200)
            .map((v: string) => ({ value: v, label: v }));
        }

        return control;
      })
    );

    const viewModel: Record<string, any> = {
      albums: albumsFormatted,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      queryLimit: limit,
      currentType: type || 'all',
      currentFormat: format || 'all',
      querySearch: trimmedSearch,
      queryLocation: res.locals.isShareView ? '' : (location || ''),
      queryGenre: genre || '',
      queryStyle: style || '',
      queryPlatform: platform || '',
      queryArtist: trimmedArtist,
      queryDecade: decade || '',
      filterMode,
      queryFilterMode: filterMode,
      // Tells an empty page apart from an empty result: the wishlist keeps its
      // "nothing here yet" invitation for a shelf that really is empty, and falls
      // back to the plain grid when a filter is what emptied it. The selected type
      // counts as one even though it lands on `query.kind` instead of the buckets
      // above, or picking a type the shelf holds none of would take away the
      // controls needed to leave it.
      hasActiveFilters: allConditions.length > 0 || (!!type && type !== 'all'),
      currentSort: sort,
      filterMap,
      artistList,
      locations,
      genres,
      styles,
      platforms,
      hasYear,
      creatorFilterLabel,
      extraFilters,
      extraAny: EXTRA_ANY,
      extraNone: EXTRA_NONE,
      user: res.locals.user,
      settings,
      activeView,
      collectionViews: viewRegistry.getAvailable(viewContext)
    };

    // Only the view being rendered gets to add to the page, so a view nobody is
    // looking at costs nothing. It reads what is already there, which is how it
    // reaches the filters the page resolved above.
    if (activeView.buildData) {
      Object.assign(viewModel, await activeView.buildData(viewContext, viewModel));
    }

    return viewModel;
  } catch (err: any) {
    console.error("Collection page loading error:", err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
    return null;
  }
}

// How many labels one sheet may hold. Not a storage limit but a latency one: every
// box is a code rendered in-process, and Node renders them on the one thread that also
// serves everyone else, so a sheet is deliberately capped at a plausible print run
// (measured: ~2.3s of blocked event loop for 200 QR codes).
const MAX_SHEET_LABELS = 200;

// Bulk/sheet QR labels for a set of items picked on the collection page. Generic
// rather than per-plugin: a mixed-type collection page can select items across
// kinds in one go, so each item resolves its own plugin individually below.
router.post('/collection/labels', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      return res.redirect('/collection');
    }

    const rawIds = req.body?.ids;
    const idList: string[] = Array.isArray(rawIds) ? rawIds : (rawIds ? [rawIds] : []);
    const ids = idList
      .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
      .slice(0, MAX_SHEET_LABELS);

    if (ids.length === 0) {
      return res.redirect('/collection');
    }

    // Same restrictions the grid the selection was made in already applies: an id
    // reaching this route by hand must not print what browsing cannot reach.
    const query: any = { _id: { $in: ids }, collection: activeCollectionId, in_wishlist: false };
    applyVisibilityFilter(query, res.locals.isCollectionAdmin, res.locals.settings);
    applyEnabledModulesFilter(query, res.locals.settings);
    applyContainedFilter(query);

    // Sorted the way the grid sorts by default, so the sheet comes out in the order
    // the boxes were ticked in rather than in whatever order Mongo returns an $in.
    const items = await Item.find(query).sort({ sort_title: 1 }).lean();

    // One code type for the whole sheet, picked once by the caller: a mixed sheet
    // (some boxes QR, some barcode) would be confusing to scan through, so a barcode
    // sheet skips items with no barcode value rather than falling back to QR per item.
    const codeType: 'qr' | 'barcode' = req.body?.type === 'barcode' ? 'barcode' : 'qr';

    const labels = (await Promise.all(items.map(async (item: any) => {
      const plugin = registry.getByKind(item.kind);
      if (!plugin) {
        // A kind whose module got disabled since the item was added: skip it
        // rather than fail the whole sheet over one stale item.
        console.warn(`[LABELS] Skipping item ${item._id}: no plugin for kind "${item.kind}"`);
        return null;
      }

      if (codeType === 'barcode') {
        // Trimmed: a barcode field holding only spaces encodes into a valid but
        // meaningless symbol, which prints as a label nobody can act on.
        const barcodeValue = (item.barcode || '').trim();
        if (!barcodeValue) {
          console.warn(`[LABELS] Skipping item ${item._id}: no barcode value for a barcode sheet`);
          return null;
        }
        const barcodeDataUrl = await generateBarcodeDataUrl(barcodeValue);
        if (!barcodeDataUrl) {
          console.warn(`[LABELS] Skipping item ${item._id}: barcode generation failed`);
          return null;
        }
        return { item: plugin.formatForView(item), plugin, codeDataUrl: barcodeDataUrl };
      }

      const url = `${getPublicProtocol(req)}://${req.get('host')}${BASE_URL}${plugin.routePrefix}/${item._id}`;
      const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
      return { item: plugin.formatForView(item), plugin, codeDataUrl: qrDataUrl };
    }))).filter(Boolean);

    // A barcode sheet whose every item turned out to have no barcode still gets a
    // page: the sheet opens in a new tab, and silently landing back on the collection
    // there reads as the print having failed for no reason.
    res.render('label-sheet', { labels, codeType, user: res.locals.user });
  } catch (err: any) {
    console.error('Bulk label error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// Create a collection as an ordinary member. Gated on the instance-wide toggle and
// per-user quota (utils/instanceSettings.ts); instance admins bypass both and also
// have the richer /admin/collections/create path. The creator becomes 'admin' of what
// they create, which grants them the collection admin page, its settings and members.
router.post('/collection/create', requireAuth, async (req: any, res: any) => {
  try {
    // Re-checked server-side: the UI hides the entry points, but the toggle may have
    // been switched off (or the quota filled from another tab) since the page was rendered.
    const verdict = await checkCollectionCreation(req.user);
    if (verdict !== 'ok') {
      return res.redirect(verdict === 'quota' ? '/?msg=error_collection_quota' : '/?msg=error_collection_forbidden');
    }

    const name = (req.body.name || '').trim().slice(0, 60);
    if (!name) {
      return res.redirect('/?msg=error_collection_name');
    }

    const collection = await Collection.create({
      name,
      slug: await generateUniqueSlug(name),
      createdBy: req.user._id,
      isDefault: false,
      members: [{ user: req.user._id, role: 'admin' }]
    });

    // Land the user in the collection they just created rather than leaving them on
    // whatever they were browsing (for a first-time user, on the no-collection page).
    await User.updateOne(
      { _id: req.user._id },
      { $set: { lastActiveCollectionId: collection._id } }
    );

    console.log(`[COLLECTION] ${req.user.email} created "${collection.name}" (${collection._id})`);
    res.redirect('/?msg=collection_created');
  } catch (err: any) {
    console.error('Collection self-create error:', err.message);
    res.redirect('/?msg=error_collection_name');
  }
});

// Switch the user's active collection. Requires membership: without this check,
// a signed-in user could switch into and browse any collection by guessing its id.
router.post('/collection/switch', requireAuth, async (req: any, res: any) => {
  const back = req.get('Referer') || '/';
  try {
    const { collectionId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(collectionId)) {
      return res.redirect(back);
    }

    const target = await Collection.findOne({
      _id: collectionId,
      'members.user': req.user._id
    });
    if (!target) {
      return res.redirect(back);
    }

    await User.updateOne(
      { _id: req.user._id },
      { $set: { lastActiveCollectionId: target._id } }
    );

    console.log(`[COLLECTION] ${req.user.email} switched to "${target.name}" (${target._id})`);

    // Only follow redirectTo if it's a same-site relative path: a leading "/" but not
    // "//" (browsers treat "//host" as protocol-relative, i.e. an external redirect).
    const redirectTo = req.body.redirectTo;
    const isSafeRelativePath = typeof redirectTo === 'string' && redirectTo.startsWith('/') && !redirectTo.startsWith('//');
    res.redirect(isSafeRelativePath ? redirectTo : back);
  } catch (err: any) {
    console.error("Collection switch error:", err.message);
    res.redirect(back);
  }
});

export default router;
