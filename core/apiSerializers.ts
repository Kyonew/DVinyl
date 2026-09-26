import { PluginDefinition } from './types';

/** Envelope every /api/v1 item response shares: { id, kind, title, year, images, ...pluginFields }. */
export function toApiItem(rawItem: any, plugin: PluginDefinition): any {
  const formatted = plugin.formatForView(rawItem);
  if (!formatted) return null;
  const { _id, __v, ...rest } = formatted;
  return { id: String(rawItem._id ?? _id), kind: rawItem.kind, ...rest };
}
