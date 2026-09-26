import mongoose from 'mongoose';
import { registry } from '../../core/registry';
import { loadPlugins } from '../../core/loadPlugins';
import { PluginDefinition } from '../../core/types';
import { PermanentRefreshError } from '../../core/helpers';

let loaded = false;
export function loadPluginsOnce(): void {
  if (!loaded) {
    loadPlugins();
    loaded = true;
  }
}

export const TEST_PLUGIN_ID = 'testkind';
export const TEST_PLUGIN_KIND = 'TestKind';
export const TEST_PLUGIN_TYPE = 'testkind';

let testPlugin: PluginDefinition | undefined;

/** Deterministic searchable plugin; its provider never touches the network. */
export function registerTestPlugin(): PluginDefinition {
  if (testPlugin) return testPlugin;

  testPlugin = {
    id: TEST_PLUGIN_ID,
    kind: TEST_PLUGIN_KIND,
    label: 'Test Kind',
    icon: 'fa-flask',
    routePrefix: '/testkind',
    collectionType: TEST_PLUGIN_TYPE,
    i18nKey: 'testkind',
    creatorField: 'creator',
    externalIdField: 'test_external_id',
    supportsBarcodeSearch: false,
    schemaDefinition: {
      creator: { type: String, default: '' },
      platform: { type: String, default: '' },
      test_external_id: { type: String, default: '' }
    },
    formFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, showIn: ['add', 'edit'] },
      { name: 'creator', label: 'Creator', type: 'text', showIn: ['add', 'edit'] }
    ],
    formats: [
      { value: 'standard', label: 'Standard' },
      { value: 'deluxe', label: 'Deluxe' }
    ],
    searchProvider: {
      name: 'Fake',
      async search(query: string) {
        return [{ id: `fake-${query}`, title: `Result for ${query}`, creator: 'Fake Creator', year: '2020' }];
      },
      async getDetails(id: string) {
        return { title: `Detail ${id}`, creator: 'Fake Creator', year: '2020', test_external_id: id };
      }
    },
    getStats(items: any[]) {
      return { testkind: items.length };
    },
    formatForView(item: any) {
      return {
        _id: item._id,
        title: item.title,
        year: item.year,
        creator: item.creator,
        images: item.images || [],
        cover_image: item.cover_image || '',
        test_external_id: item.test_external_id
      };
    },
    async findDuplicate(collectionId: any, data: Record<string, any>) {
      if (!data?.title) return null;
      return mongoose.model(TEST_PLUGIN_KIND).findOne({ collection: collectionId, title: data.title }).lean();
    },
    async getVariants() {
      return [];
    },
    async refreshItem() {
      return { year: '1999', creator: 'Refreshed Creator' };
    }
  };

  registry.register(testPlugin);
  return testPlugin;
}

export const NO_REFRESH_PLUGIN_ID = 'testnorefresh';
export const NO_REFRESH_PLUGIN_KIND = 'TestNoRefresh';
export const NO_REFRESH_PLUGIN_TYPE = 'testnorefresh';

let noRefreshPlugin: PluginDefinition | undefined;

/** Same shape as the test plugin, minus `refreshItem`, to exercise the 404 branch. */
export function registerNoRefreshPlugin(): PluginDefinition {
  if (noRefreshPlugin) return noRefreshPlugin;

  noRefreshPlugin = {
    id: NO_REFRESH_PLUGIN_ID,
    kind: NO_REFRESH_PLUGIN_KIND,
    label: 'Test No Refresh',
    icon: 'fa-flask',
    routePrefix: '/testnorefresh',
    collectionType: NO_REFRESH_PLUGIN_TYPE,
    i18nKey: 'testnorefresh',
    creatorField: 'creator',
    schemaDefinition: { creator: { type: String, default: '' } },
    formFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, showIn: ['add', 'edit'] }
    ],
    formats: [{ value: 'standard', label: 'Standard' }],
    getStats(items: any[]) {
      return { testnorefresh: items.length };
    },
    formatForView(item: any) {
      return { _id: item._id, title: item.title, year: item.year, creator: item.creator };
    },
    async findDuplicate() {
      return null;
    },
    async getVariants() {
      return [];
    }
  };

  registry.register(noRefreshPlugin);
  return noRefreshPlugin;
}

export const ESTIMATE_PLUGIN_ID = 'testestimate';
export const ESTIMATE_PLUGIN_KIND = 'TestEstimate';
export const ESTIMATE_PLUGIN_TYPE = 'testestimate';

/**
 * Scriptable, network-free state for the fake estimator. `outcomes` is consumed one
 * entry per estimatePrice call (default `'ok'`), so a test can force a mixed run.
 */
export const estimatePluginState = {
  outcomes: [] as ('ok' | 'null' | 'throw')[],
  calls: [] as string[],
  delayMs: 0
};

let estimatePlugin: PluginDefinition | undefined;

/** Deterministic estimate-capable plugin; nothing here touches the network. */
export function registerEstimatePlugin(): PluginDefinition {
  if (estimatePlugin) return estimatePlugin;

  estimatePlugin = {
    id: ESTIMATE_PLUGIN_ID,
    kind: ESTIMATE_PLUGIN_KIND,
    label: 'Test Estimate',
    icon: 'fa-tag',
    routePrefix: '/testestimate',
    collectionType: ESTIMATE_PLUGIN_TYPE,
    i18nKey: 'testestimate',
    creatorField: 'creator',
    externalIdField: 'test_external_id',
    bulkRefreshDelayMs: 0,
    supportsBarcodeSearch: false,
    schemaDefinition: {
      creator: { type: String, default: '' },
      test_external_id: { type: String, default: '' }
    },
    formFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, showIn: ['add', 'edit'] }
    ],
    formats: [{ value: 'standard', label: 'Standard' }],
    collectionActions: [
      {
        id: 'estimate',
        label: 'Estimate',
        icon: 'fa-calculator',
        behavior: 'estimate',
        estimate: {
          idsEndpoint: '/api/collection/ids',
          estimateEndpoint: '/api/estimate',
          idField: 'test_external_id',
          maxMultiplier: 2
        }
      }
    ],
    async estimatePrice(externalId: string) {
      estimatePluginState.calls.push(externalId);
      if (estimatePluginState.delayMs > 0) {
        await new Promise(r => setTimeout(r, estimatePluginState.delayMs));
      }
      const outcome = estimatePluginState.outcomes.shift() ?? 'ok';
      if (outcome === 'throw') throw new Error('provider down');
      if (outcome === 'null') return null;
      return { source: 'market', price: { value: 10, currency: 'EUR' }, details: 'test price' };
    },
    getStats(items: any[]) {
      return { testestimate: items.length };
    },
    formatForView(item: any) {
      return { _id: item._id, title: item.title, test_external_id: item.test_external_id };
    },
    async findDuplicate() {
      return null;
    },
    async getVariants() {
      return [];
    }
  };

  registry.register(estimatePlugin);
  return estimatePlugin;
}

export const OPTIONS_PLUGIN_ID = 'testoptions';
export const OPTIONS_PLUGIN_KIND = 'TestOptions';
export const OPTIONS_PLUGIN_TYPE = 'testoptions';
export const OPTIONS_SETTING_KEY = 'betaMode';
export const OPTIONS_NAVBAR_IDS = ['testoptions_all', 'testoptions_new', 'testoptions_top', 'testoptions_random'];
export const OPTIONS_WIDGET_ID = 'testoptions_count';
export const OPTIONS_FAST_ADD = 'testoptions';

let optionsPlugin: PluginDefinition | undefined;

/**
 * Declares settings / navbar shortcuts / stats widgets / fastAdd options so the
 * settings endpoints have a deterministic, network-free catalog to expose.
 */
export function registerOptionsPlugin(): PluginDefinition {
  if (optionsPlugin) return optionsPlugin;

  optionsPlugin = {
    id: OPTIONS_PLUGIN_ID,
    kind: OPTIONS_PLUGIN_KIND,
    label: 'Test Options',
    icon: 'fa-sliders',
    routePrefix: '/testoptions',
    collectionType: OPTIONS_PLUGIN_TYPE,
    i18nKey: 'testoptions',
    creatorField: 'creator',
    externalIdField: 'test_external_id',
    enabledByDefault: false,
    supportsBarcodeSearch: false,
    schemaDefinition: {
      creator: { type: String, default: '' },
      test_external_id: { type: String, default: '' }
    },
    formFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, showIn: ['add', 'edit'] }
    ],
    formats: [{ value: 'standard', label: 'Standard' }],
    settings: [
      {
        key: OPTIONS_SETTING_KEY,
        label: 'testoptions.beta',
        type: 'boolean',
        default: false,
        description: 'testoptions.beta_desc'
      }
    ],
    navbarShortcuts: OPTIONS_NAVBAR_IDS.map(id => ({
      id,
      label: `testoptions.${id}`,
      url: `/collection?type=${OPTIONS_PLUGIN_TYPE}`
    })),
    statsWidgets: [
      { id: OPTIONS_WIDGET_ID, label: 'testoptions.count', icon: 'fa-flask', color: 'bg-primary-theme/20', kind: 'count' }
    ],
    fastAddOptions: [
      { value: OPTIONS_FAST_ADD, label: 'testoptions.fast_add', icon: 'fa-flask', color: 'peer-checked:bg-blue-500', url: '/testoptions/add' }
    ],
    getStats(items: any[]) {
      return { [OPTIONS_WIDGET_ID]: items.length };
    },
    formatForView(item: any) {
      return { _id: item._id, title: item.title };
    },
    async findDuplicate() {
      return null;
    },
    async getVariants() {
      return [];
    }
  };

  registry.register(optionsPlugin);
  return optionsPlugin;
}

export const IMPORTER_PLUGIN_ID = 'testimporter';
export const IMPORTER_PLUGIN_KIND = 'TestImporter';
export const IMPORTER_PLUGIN_TYPE = 'testimporter';
export const IMPORTER_ID = 'test-import';
export const ADMIN_IMPORTER_ID = 'test-import-admin';

/** Importer that runs to completion on its own, emitting the same events as the real ones. */
export const importerState = {
  created: [] as string[]
};

export function registerImporterPlugin(): PluginDefinition {
  const existing = registry.get(IMPORTER_PLUGIN_ID);
  if (existing) return existing;

  const handler = async (req: any) => {
    const titles: string[] = Array.isArray(req.body?.titles) ? req.body.titles : ['Imported One'];
    req.io.emit('import_progress', { current: 0, total: titles.length });
    for (let i = 0; i < titles.length; i++) {
      await mongoose.model(IMPORTER_PLUGIN_KIND).create({
        title: titles[i],
        creator: 'Imported',
        owner: req.user._id,
        // The web handlers read res.locals.activeCollectionId; the runner sets it. The
        // fake reads req.body.collectionId instead so its assertions are self-contained.
        collection: req.body.collectionId
      });
      importerState.created.push(String(titles[i]));
      req.io.emit('import_progress', { current: i + 1, total: titles.length });
    }
    req.io.emit('import_finished', { count: titles.length });
  };

  const plugin: PluginDefinition = {
    id: IMPORTER_PLUGIN_ID,
    kind: IMPORTER_PLUGIN_KIND,
    label: 'Test Importer',
    icon: 'fa-flask',
    routePrefix: '/testimporter',
    collectionType: IMPORTER_PLUGIN_TYPE,
    i18nKey: 'testimporter',
    creatorField: 'creator',
    schemaDefinition: { creator: { type: String, default: '' } },
    formFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, showIn: ['add', 'edit'] }
    ],
    formats: [{ value: 'standard', label: 'Standard' }],
    getStats(items: any[]) { return { testimporter: items.length }; },
    formatForView(item: any) { return { _id: item._id, title: item.title, creator: item.creator }; },
    async findDuplicate() { return null; },
    async getVariants() { return []; },
    importers: [
      {
        id: IMPORTER_ID,
        handler,
        ui: {
          label: 'Test import',
          icon: 'fa-file-import',
          fields: [{ name: 'titles', label: 'Titles', type: 'text' }],
          submitLabel: 'Import'
        }
      },
      {
        id: ADMIN_IMPORTER_ID,
        requireAdmin: true,
        handler,
        ui: {
          label: 'Test admin import',
          icon: 'fa-file-import',
          fields: [{ name: 'token', label: 'Token', type: 'text', required: true }],
          submitLabel: 'Import'
        }
      }
    ]
  };

  registry.register(plugin);
  return plugin;
}

export const REFRESH_PLUGIN_ID = 'testrefresh';
export const REFRESH_PLUGIN_KIND = 'TestRefresh';
export const REFRESH_PLUGIN_TYPE = 'testrefresh';

/**
 * Scriptable, network-free state for the fake refresh provider. `outcomes` is consumed one
 * entry per `refreshItem` call (default `'ok'`), so a test can force a mixed run; `delayMs`
 * keeps a run in flight long enough to exercise the 409 guard.
 */
export const refreshPluginState = {
  outcomes: [] as ('ok' | 'transient' | 'permanent')[],
  calls: [] as string[],
  delayMs: 0
};

let refreshPlugin: PluginDefinition | undefined;

/** Deterministic refresh-capable plugin; nothing here touches the network. */
export function registerRefreshPlugin(): PluginDefinition {
  if (refreshPlugin) return refreshPlugin;

  refreshPlugin = {
    id: REFRESH_PLUGIN_ID,
    kind: REFRESH_PLUGIN_KIND,
    label: 'Test Refresh',
    icon: 'fa-rotate',
    routePrefix: '/testrefresh',
    collectionType: REFRESH_PLUGIN_TYPE,
    i18nKey: 'testrefresh',
    creatorField: 'creator',
    externalIdField: 'test_external_id',
    bulkRefreshDelayMs: 0,
    supportsBarcodeSearch: false,
    schemaDefinition: {
      creator: { type: String, default: '' },
      test_external_id: { type: String, default: '' }
    },
    formFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, showIn: ['add', 'edit'] },
      { name: 'creator', label: 'Creator', type: 'text', showIn: ['add', 'edit'] }
    ],
    formats: [{ value: 'standard', label: 'Standard' }],
    async refreshItem(item: any) {
      refreshPluginState.calls.push(String(item._id));
      if (refreshPluginState.delayMs > 0) {
        await new Promise(r => setTimeout(r, refreshPluginState.delayMs));
      }
      const outcome = refreshPluginState.outcomes.shift() ?? 'ok';
      if (outcome === 'permanent') throw new PermanentRefreshError('permanent test failure');
      if (outcome === 'transient') throw new Error('transient test failure');
      return { creator: 'Refreshed Creator', genre: 'Rock', genres: ['Rock'], styles: ['Indie'] };
    },
    getStats(items: any[]) {
      return { testrefresh: items.length };
    },
    formatForView(item: any) {
      return { _id: item._id, title: item.title, creator: item.creator };
    },
    async findDuplicate() {
      return null;
    },
    async getVariants() {
      return [];
    }
  };

  registry.register(refreshPlugin);
  return refreshPlugin;
}
