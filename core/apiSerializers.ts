import { PluginDefinition } from './types';

/** Envelope every /api/v1 item response shares: { id, kind, title, year, images, ...pluginFields }. */
export function toApiItem(rawItem: any, plugin: PluginDefinition): any {
  const formatted = plugin.formatForView(rawItem);
  if (!formatted) return null;
  const { _id, __v, ...rest } = formatted;
  return { id: String(rawItem._id ?? _id), kind: rawItem.kind, ...rest };
}

/**
 * One piece of shelf furniture as the API exposes it. `counts` is keyed by a cell's exact
 * `location`, so a piece reads the same whether it came from a furniture read or a write.
 * Lives here beside `toApiItem` so the shelves read and write routes share one shape.
 */
export function furnitureToApi(piece: any, counts: Map<string, number>) {
  return {
    id: String(piece._id),
    name: piece.name,
    layout: piece.layout,
    columns: piece.columns,
    rows: piece.rows,
    order: piece.order,
    cells: (piece.cells || []).map((cell: any) => ({
      name: cell.name,
      key: cell.key,
      row: cell.row,
      column: cell.column,
      capacity: cell.capacity || 0,
      count: counts.get(cell.name) || 0
    }))
  };
}
