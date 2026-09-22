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
