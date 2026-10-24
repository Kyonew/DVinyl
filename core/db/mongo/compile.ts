/**
 * Turns core filters and sorts (core/db/filter.ts) into MongoDB queries.
 *
 * The only place that knows what a core filter means to Mongo. Ids stay text here: the
 * model a query runs through casts them, as it does for any value of a declared path.
 */

import { Filter, Sort } from '../filter';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toMongoFilter(filter: Filter): Record<string, any> {
  switch (filter.op) {
    case 'all': return {};
    case 'none': return { _id: { $in: [] } };
    case 'and': return { $and: filter.filters.map(toMongoFilter) };
    case 'or': return { $or: filter.filters.map(toMongoFilter) };
    case 'not': return { $nor: [toMongoFilter(filter.filter)] };
    case 'eq': return { [filter.field]: filter.value };
    case 'in': return { [filter.field]: { $in: filter.values } };
    case 'ci': return { [filter.field]: new RegExp(`^${escapeRegExp(filter.value)}$`, 'i') };
    case 'contains': return { [filter.field]: new RegExp(escapeRegExp(filter.value), 'i') };
    case 'missing': return { [filter.field]: { $exists: false } };
    case 'blank': return { [filter.field]: { $in: [null, '', []] } };
    case 'range': {
      const bounds: Record<string, number | Date> = {};
      if (filter.gte !== undefined) bounds.$gte = filter.gte;
      if (filter.lte !== undefined) bounds.$lte = filter.lte;
      return { [filter.field]: bounds };
    }
  }
}

export function toMongoSort(sort: Sort): Record<string, 1 | -1> {
  const out: Record<string, 1 | -1> = {};
  for (const { field, dir } of sort) out[field] = dir === 'asc' ? 1 : -1;
  return out;
}
