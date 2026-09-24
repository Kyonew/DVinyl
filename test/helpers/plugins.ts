import mongoose from 'mongoose';
import { registry } from '../../core/registry';
import { loadPlugins } from '../../core/loadPlugins';
import { PluginDefinition } from '../../core/types';

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
