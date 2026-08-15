import Item from '../models/Item';
import { PluginDefinition } from './types';

/**
 * Values offered under a field's input, keyed by field name.
 *
 * Two sources, merged: what the collection already holds on that path, and whatever the
 * plugin can say about the item being edited (the platforms an external API lists for
 * that exact game, for instance).
 *
 * Deliberately not a fixed list. Consoles, editions and shelves keep being invented, so
 * a literal written today is wrong next year and leaves the user unable to enter what
 * they own. Suggestions guide without constraining, and the set grows on its own: the
 * first item carrying a new value makes it available to the whole collection.
 */
export async function buildFieldSuggestions(
  plugin: PluginDefinition,
  collectionId: any,
  item?: any
): Promise<Record<string, string[]>> {
  // 'location' is a core path every module carries, so it is always offered.
  const names = Array.from(new Set(['location', ...(plugin.suggestionFields || [])]));
  const suggestions: Record<string, string[]> = {};

  await Promise.all(names.map(async name => {
    const stored = await Item.distinct(name, {
      collection: collectionId,
      [name]: { $nin: ['', null] }
    }) as any[];
    const fromPlugin = item && plugin.suggestionsFor ? plugin.suggestionsFor(name, item) : [];
    const merged = [...stored, ...fromPlugin].map(v => String(v ?? '').trim()).filter(Boolean);
    suggestions[name] = Array.from(new Set(merged)).sort((a, b) => a.localeCompare(b));
  }));

  return suggestions;
}
