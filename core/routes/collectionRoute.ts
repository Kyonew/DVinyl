import express from 'express';
import mongoose from 'mongoose';
import { registry } from '../registry';
import Item from '../../models/Item';
import Collection from '../../models/Collection';
import User from '../../models/User';
import { requireAuth } from '../../middleware/authMiddleware';
import { applyVisibilityFilter, applyEnabledModulesFilter } from '../../utils/visibilityHelper';
import { escapeRegExp } from '../helpers';
import { generateUniqueSlug } from '../../utils/collectionHelpers';
import { checkCollectionCreation } from '../../utils/instanceSettings';
import {
  getExtraFields, buildExtraFieldConditions, parseExtraSort, extraSortKey,
  filterParam, isFilterable, isRangeFilter, isPickerFilter, EXTRA_ANY, EXTRA_NONE
} from '../pluginExtraFields';

const router = express.Router();

router.get('/wishlist', requireAuth, async (req: any, res: any) => {
  try {
    if (!res.locals.activeCollectionId) {
      return res.render('no-collection', { user: res.locals.user, msgKey: req.query.msg });
    }
    let query: any = {
      collection: res.locals.activeCollectionId,
      in_wishlist: true
    };
    applyVisibilityFilter(query, res.locals.isCollectionAdmin, res.locals.settings);

    applyEnabledModulesFilter(query, res.locals.settings);

    const items = await Item.find(query).sort({ added_at: -1 }).lean();

    res.render('wishlist', {
      albums: items.map(item => {
        const plugin = registry.getByKind(item.kind as any);
        return plugin ? plugin.formatForView(item) : item;
      }),
      user: res.locals.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

router.get('/collection', requireAuth, async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      return res.render('no-collection', { user: res.locals.user, msgKey: req.query.msg });
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

    let query: any = { collection: activeCollectionId, in_wishlist: false };
    // Two separate buckets. `conditions` holds the user's criteria, which filterMode
    // 'hide' inverts. `scopeConditions` holds what defines *which items the page is
    // about at all* (the selected type): inverting that would widen the page to other
    // types instead of narrowing it, so it is always ANDed as-is.
    let conditions: any[] = [];
    let scopeConditions: any[] = [];

    const enabledPlugins = registry.getEnabled(settings);

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
    if (location) {
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
    const typeScope = (): any => {
      const base: any = { collection: activeCollectionId };
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

    const albums = await Item.find(query)
      .sort(buildSortObj())
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // DYNAMIC FILTER MAP FROM REGISTRY
    // Read off the decorated registry, not the bare one: the collection's own
    // customization lives there, and the format order it may carry has to reach the
    // filter bar the same way it reaches the form select.
    const filterMap: Record<string, { id: string; label: string }[]> = {};
    for (const plugin of enabledPlugins) {
      const customized = res.locals.registry.get(plugin.id) || plugin;
      filterMap[plugin.id] = customized.formats.map((f: any) => ({
        id: f.value,
        label: req.t(f.label)
      }));
    }

    // DYNAMIC ARTIST LIST
    const artistList = await (async () => {
      const baseQuery: any = { collection: activeCollectionId, in_wishlist: false };
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

    const locations = await Item.distinct('location', { collection: activeCollectionId, location: { $nin: ['', null] } });

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

    res.render('collection', {
      albums: albumsFormatted,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      queryLimit: limit,
      currentType: type || 'all',
      currentFormat: format || 'all',
      querySearch: trimmedSearch,
      queryLocation: location || '',
      queryGenre: genre || '',
      queryStyle: style || '',
      queryPlatform: platform || '',
      queryArtist: trimmedArtist,
      queryDecade: decade || '',
      filterMode,
      queryFilterMode: filterMode,
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
      settings
    });
  } catch (err: any) {
    console.error("Collection page loading error:", err.message);
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
