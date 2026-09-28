import { Router } from 'express';
import { registry } from '../../../core/registry';
import { canRefresh, hasSearch, isSearchable, isSourceConfigured, pluginSources } from '../../../core/sources';
import { requireApiAuth } from '../../../middleware/authMiddleware';

const router = Router();

router.get('/plugins', requireApiAuth, async (req: any, res: any) => {
  const plugins = registry.getAll().map(p => ({
    id: p.id,
    kind: p.kind,
    label: p.label,
    icon: p.icon,
    routePrefix: p.routePrefix,
    collectionType: p.collectionType,
    formFields: p.formFields.map(f => ({
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required || false,
      options: f.options,
      default: f.default,
      showIn: f.showIn,
      group: f.group,
      placeholder: f.placeholder,
      hint: f.hint
    })),
    formats: p.formats,
    // The extra fields the plugin's own search form adds (games' ScreenScraper
    // `platform`). A client sends any of these names in the search body.
    searchFormFields: p.searchFormFields || [],
    // The extra sort entries this type adds to the listing's menu (books order by
    // series). The client sends `${key}_asc` / `${key}_desc` as the `sort` parameter.
    // `fields` stays here: how the order is built is the server's business.
    sortOptions: (p.sortOptions || []).map(o => ({ key: o.key, label: o.label })),
    creatorField: p.creatorField,
    externalIdField: p.externalIdField,
    externalIdLabel: p.externalIdLabel,
    externalIdHint: p.externalIdHint,
    supportsBarcodeSearch: p.supportsBarcodeSearch || false,
    supportsPriceEstimate: p.supportsPriceEstimate || false,
    // What the add/search/refresh flows can actually offer: whether the plugin searches at
    // all, whether a bulk refresh can run, and the databases a client may pick between.
    hasSearch: hasSearch(p),
    canRefresh: canRefresh(p),
    sources: pluginSources(p).map(s => ({
      id: s.id,
      name: s.name,
      searchable: isSearchable(s),
      configured: isSourceConfigured(s)
    }))
  }));

  res.status(200).json({ plugins });
});

export = router;
