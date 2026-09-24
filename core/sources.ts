import { PluginDefinition, ExternalSource, SearchProvider } from './types';
import { PermanentRefreshError } from './helpers';

/**
 * Where a plugin looks items up, and which of those places is usable right now.
 *
 * A plugin used to hold exactly one provider, so "can this plugin search?" and "is its
 * API key set?" were the same question and both were answered inline wherever they came
 * up. With several sources behind one plugin they are not: a plugin is searchable as
 * soon as *one* of its sources is configured, and each source answers for its own
 * credentials. Everything that used to test `plugin.searchProvider` goes through here.
 */

const LEGACY_WRAPPERS = new WeakMap<PluginDefinition, ExternalSource[]>();

/**
 * Turns a provider class into a source, which is all a plugin whose provider already
 * exists has to do. The provider keeps answering the queries; the source adds what the
 * core needs around it: a stable id to store, the credentials it runs on, and where its
 * records live on the web.
 */
export function sourceFromProvider(
  provider: SearchProvider,
  spec: {
    id: string;
    requiredEnvKeys?: string[];
    itemUrl?(externalId: string): string | null;
    // A service that answers both questions declares its image side here rather than
    // being split into two sources wearing the same name.
    searchImages?(query: string, options?: { language?: string }): Promise<string[]>;
  }
): SearchableSource {
  return {
    ...spec,
    name: provider.name,
    search: (query, options) => provider.search(query, options),
    getDetails: (id, options) => provider.getDetails(id, options)
  };
}

/**
 * Every source the plugin declares, configured or not.
 *
 * A plugin that still declares the old single `searchProvider` is served one source
 * carrying the plugin's own id. That id ends up stored on the items it fills in, so it
 * has to be stable and unique across plugins, which the plugin id already is.
 */
export function pluginSources(plugin: PluginDefinition): ExternalSource[] {
  if (plugin.sources && plugin.sources.length > 0) return plugin.sources;
  if (!plugin.searchProvider) return [];

  const cached = LEGACY_WRAPPERS.get(plugin);
  if (cached) return cached;

  const wrapped: ExternalSource[] = [{
    id: plugin.id,
    name: plugin.searchProvider.name,
    ...(plugin.requiredEnvKeys ? { requiredEnvKeys: plugin.requiredEnvKeys } : {}),
    search: (query, options) => plugin.searchProvider!.search(query, options),
    getDetails: (id, options) => plugin.searchProvider!.getDetails(id, options)
  }];
  LEGACY_WRAPPERS.set(plugin, wrapped);
  return wrapped;
}

/**
 * A source that can actually be searched. Narrowing it in the type is what lets the add
 * and confirm routes call search/getDetails without a guard each time: a source reaches
 * them only through the resolver below, which never hands back one that cannot answer.
 */
export type SearchableSource = ExternalSource & Required<Pick<ExternalSource, 'search' | 'getDetails'>>;

/**
 * Searching takes both halves. A source offering results nobody can expand would fill
 * the page with cards that lead to an error, so it is not offered for searching at all.
 */
export function isSearchable(source: ExternalSource): source is SearchableSource {
  return typeof source.search === 'function' && typeof source.getDetails === 'function';
}

/**
 * Builds a source that only knows where pictures are.
 *
 * A service can have cover art for a record it cannot describe: iTunes hands out artwork
 * and nothing else, no item to add and nothing ever attributed to it. Declaring only the
 * capability it has is what keeps it out of the search picker while still feeding the
 * image one.
 */
export function imageSourceFrom(spec: {
  id: string;
  name: string;
  requiredEnvKeys?: string[];
  searchImages(query: string, options?: { language?: string }): Promise<string[]>;
}): ExternalSource {
  return { ...spec };
}

/** True when every environment variable the source needs is set. */
export function isSourceConfigured(source: ExternalSource): boolean {
  return (source.requiredEnvKeys || []).every(key => !!process.env[key]);
}

/**
 * The plugin's sources in the order this collection prefers them.
 *
 * The order is a preference, not a definition: it is stored per collection, it only ever
 * mentions ids, and it is re-read against what the plugin currently declares. A source
 * dropped from a plugin therefore leaves nothing behind, and one added by an update falls
 * in at the end rather than jumping ahead of a choice somebody made.
 */
export function orderedSources(plugin: PluginDefinition, settings?: any): ExternalSource[] {
  const declared = pluginSources(plugin);
  const preferred = settings?.sourceOrder?.[plugin.id];
  if (!Array.isArray(preferred) || preferred.length === 0) return declared;

  const rank = new Map<string, number>();
  preferred.forEach((id: unknown, index: number) => {
    if (typeof id === 'string' && !rank.has(id)) rank.set(id, index);
  });

  const keyOf = (source: ExternalSource) =>
    rank.has(source.id) ? rank.get(source.id)! : preferred.length + declared.indexOf(source);

  return [...declared].sort((a, b) => keyOf(a) - keyOf(b));
}

/** The sources that can actually be called, in this collection's order. */
export function configuredSources(plugin: PluginDefinition, settings?: any): ExternalSource[] {
  return orderedSources(plugin, settings).filter(isSourceConfigured);
}

/** Those of them that can be searched: what the add page offers and what a query goes to. */
export function searchableSources(plugin: PluginDefinition, settings?: any): SearchableSource[] {
  return configuredSources(plugin, settings).filter(isSearchable);
}

/**
 * Every image-capable source of the plugin, all of which are asked at once.
 *
 * Images are not picked from one place the way metadata is: a record's front cover and
 * the scan of its label come from different services, and the picker shows both lots
 * side by side. Merging is the whole point, so there is no "the" image source.
 */
export function imageSources(plugin: PluginDefinition, settings?: any): ExternalSource[] {
  return configuredSources(plugin, settings).filter(s => typeof s.searchImages === 'function');
}

/**
 * Whether the plugin offers a search at all: what decides between an "add" page backed
 * by a provider and a manual form. Declaring a source is enough, credentials or not:
 * a missing key is a configuration problem the admin is told about, not a reason to
 * turn the plugin into a manual-only one behind the user's back.
 */
export function hasSearch(plugin: PluginDefinition): boolean {
  return pluginSources(plugin).some(isSearchable);
}

/**
 * Whether the plugin's add page offers the barcode scanner, which every "scan" shortcut
 * links straight into. A search is required to have an add page at all, and a plugin
 * whose search ignores barcodes opts out with `noBarcodeScan`.
 */
export function hasBarcodeScan(plugin: PluginDefinition): boolean {
  return hasSearch(plugin) && !plugin.noBarcodeScan;
}

/**
 * The source a request means, by id, falling back to the plugin's first configured one.
 *
 * Unknown ids fall back rather than fail: an id reaches here from a query string and
 * from values stored on items, so it can name a source that was removed, renamed or
 * whose keys have since been taken out of the environment.
 */
export function resolveSource(plugin: PluginDefinition, id?: string | null, settings?: any): SearchableSource | undefined {
  const available = searchableSources(plugin, settings);
  if (id) {
    const named = available.find(s => s.id === id);
    if (named) return named;
  }
  return available[0];
}

/** The source an item was filled in from, whether or not it is still configured. */
export function sourceForItem(plugin: PluginDefinition, item: any): ExternalSource | undefined {
  if (!item?.source) return undefined;
  return pluginSources(plugin).find(s => s.id === item.source);
}

/**
 * Every environment variable the plugin needs to be fully usable: its own, plus those
 * of all its sources. What the admin lists as missing; being ready, on the other hand,
 * only takes one working source (see registry.getApiKeyStatus).
 */
export function requiredEnvKeysFor(plugin: PluginDefinition): string[] {
  const keys = new Set<string>(plugin.requiredEnvKeys || []);
  // Searchable sources only, to match what getApiKeyStatus gates on. An image source
  // missing its key thins the picker; it never stops the module from being turned on,
  // so listing it here would read as a blocker it is not.
  for (const source of pluginSources(plugin).filter(isSearchable)) {
    for (const key of source.requiredEnvKeys || []) keys.add(key);
  }
  return Array.from(keys);
}

/**
 * The "source" link on an item page.
 *
 * The plugin's own externalLink is asked first: it knows its historical provider's URL
 * shape and words the label the way it wants. It returns nothing for an item that came
 * from anywhere else, since it only ever looks at its own id field, so the source that
 * actually filled the item in gets the second word.
 */
export function externalLinkFor(plugin: PluginDefinition, item: any): { label: string; url: string } | null {
  const own = plugin.externalLink ? plugin.externalLink(item) : null;
  if (own) return own;

  const source = sourceForItem(plugin, item);
  if (!source || !source.itemUrl || !item.source_id) return null;

  const url = source.itemUrl(String(item.source_id));
  return url ? { label: source.name, url } : null;
}

/**
 * Whether this plugin can refresh an item at all, either way of doing it.
 *
 * What decides whether the refresh button exists and whether the admin offers a bulk
 * run, so it has to answer for both hooks: a plugin that only declares mergeRefresh is
 * as refreshable as one that owns the whole step.
 */
export function canRefresh(plugin: PluginDefinition): boolean {
  return typeof plugin.refreshItem === 'function' || typeof plugin.mergeRefresh === 'function';
}

/**
 * Fresh metadata for one item, as a patch for the caller to write.
 *
 * The item's own source answers first, when the plugin can merge what a source returns.
 * That is the only path that reaches an item filled in from anywhere other than the
 * plugin's historical provider: refreshItem reads the plugin's own id field, which such
 * an item does not carry.
 *
 * Falls back to refreshItem for a plugin whose refresh asks its API something a plain
 * lookup by id does not answer.
 */
export async function refreshPatchFor(
  plugin: PluginDefinition,
  item: any,
  req?: any
): Promise<Record<string, any>> {
  if (plugin.mergeRefresh) {
    // The stored pair first. Failing that, the plugin's own id field read against its
    // default source, which is the same attribution the boot migration makes: a document
    // restored from an old backup carries the id without the pair until that migration
    // runs, and it has to stay refreshable in between.
    const stored = sourceForItem(plugin, item);
    const legacyId = plugin.externalIdField ? item[plugin.externalIdField] : undefined;

    const source = (stored && item.source_id) ? stored : (legacyId ? pluginSources(plugin)[0] : undefined);
    const externalId = (stored && item.source_id) ? item.source_id : legacyId;

    if (source && externalId && typeof source.getDetails === 'function') {
      if (!isSourceConfigured(source)) {
        // Waiting will not help: the credentials are missing from the environment, which
        // only an admin restarting the instance can change.
        throw new PermanentRefreshError(`${source.name} is not configured`);
      }
      const details = await source.getDetails(String(externalId), { language: req?.language });
      return plugin.mergeRefresh(item, details);
    }
  }

  if (plugin.refreshItem) return plugin.refreshItem(item, req);

  throw new PermanentRefreshError('This item carries nothing to refresh it from');
}

/**
 * Every image the plugin can offer for a query: each of its image sources, plus the
 * legacy single provider, merged in declaration order and deduplicated.
 *
 * Settled one by one rather than awaited together, so a service that is down, rate
 * limited or missing its key costs its own results and not everyone else's. That is new:
 * the picker used to fire its requests from the browser, where one rejection emptied the
 * grid even though the other service had answered.
 */
export async function gatherImages(
  plugin: PluginDefinition,
  query: string,
  options?: { language?: string },
  settings?: any
): Promise<string[]> {
  const lookups: Promise<string[]>[] = imageSources(plugin, settings).map(source => source.searchImages!(query, options));

  // A plugin that declares nothing but the old single provider keeps the picker it had.
  if (plugin.imageSearchProvider) {
    lookups.push(plugin.imageSearchProvider.search(query, options));
  }

  const settled = await Promise.allSettled(lookups);
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn(`[IMAGES] ${plugin.id}: one image source failed:`, result.reason?.message || result.reason);
    }
  }

  const urls = settled.flatMap(result =>
    result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []
  );
  return [...new Set(urls.filter(Boolean))];
}

/** One source as the admin needs to show it: what it can do, and what it is waiting for. */
export interface SourceStatus {
  id: string;
  name: string;
  searchable: boolean;
  images: boolean;
  /** Environment variables it needs that are not set. Empty means it is ready. */
  missingKeys: string[];
}

/**
 * What a plugin searches, in this collection's order, described for the admin.
 *
 * Says which service is missing which variable, rather than the single "an API key is
 * missing" the module card used to show: with several sources behind one plugin, that
 * sentence no longer names anything an admin can act on.
 */
export function sourceStatusFor(plugin: PluginDefinition, settings?: any): SourceStatus[] {
  return orderedSources(plugin, settings).map(source => ({
    id: source.id,
    name: source.name,
    searchable: isSearchable(source),
    images: typeof source.searchImages === 'function',
    missingKeys: (source.requiredEnvKeys || []).filter(key => !process.env[key])
  }));
}
