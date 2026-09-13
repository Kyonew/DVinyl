import { PluginDefinition, ExternalSource, SearchProvider } from './types';

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
  spec: { id: string; requiredEnvKeys?: string[]; itemUrl?(externalId: string): string | null }
): ExternalSource {
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

/** True when every environment variable the source needs is set. */
export function isSourceConfigured(source: ExternalSource): boolean {
  return (source.requiredEnvKeys || []).every(key => !!process.env[key]);
}

/** The sources that can actually be called, in the plugin's declared order. */
export function configuredSources(plugin: PluginDefinition): ExternalSource[] {
  return pluginSources(plugin).filter(isSourceConfigured);
}

/**
 * Whether the plugin offers a search at all: what decides between an "add" page backed
 * by a provider and a manual form. Declaring a source is enough, credentials or not:
 * a missing key is a configuration problem the admin is told about, not a reason to
 * turn the plugin into a manual-only one behind the user's back.
 */
export function hasSearch(plugin: PluginDefinition): boolean {
  return pluginSources(plugin).length > 0;
}

/**
 * The source a request means, by id, falling back to the plugin's first configured one.
 *
 * Unknown ids fall back rather than fail: an id reaches here from a query string and
 * from values stored on items, so it can name a source that was removed, renamed or
 * whose keys have since been taken out of the environment.
 */
export function resolveSource(plugin: PluginDefinition, id?: string | null): ExternalSource | undefined {
  const available = configuredSources(plugin);
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
  for (const source of pluginSources(plugin)) {
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
