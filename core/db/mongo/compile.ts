/**
 * Turns core filters and sorts (core/db/filter.ts) into MongoDB queries.
 *
 * The only place that knows what a core filter means to Mongo. Ids stay text here: the
 * model a query runs through casts them, as it does for any value of a declared path.
 */

import { Filter, Sort } from '../filter';
import { Patch } from '../patch';

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
    case 'emptyList': return { [filter.field]: { $size: 0 } };
    case 'some': return { [filter.field]: { $elemMatch: toMongoFilter(filter.filter) } };
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

export function toMongoUpdate(patch: Patch): Record<string, any> {
  const update: Record<string, any> = {};
  if (patch.set && Object.keys(patch.set).length > 0) update.$set = patch.set;
  if (patch.setOnInsert && Object.keys(patch.setOnInsert).length > 0) update.$setOnInsert = patch.setOnInsert;
  if (patch.unset && patch.unset.length > 0) {
    update.$unset = Object.fromEntries(patch.unset.map(field => [field, '']));
  }
  if (patch.push && Object.keys(patch.push).length > 0) {
    update.$push = Object.fromEntries(Object.entries(patch.push).map(([field, value]) =>
      [field, value && typeof value === 'object' && Array.isArray(value.each) ? { $each: value.each } : value]));
  }
  if (patch.addToSet && Object.keys(patch.addToSet).length > 0) update.$addToSet = patch.addToSet;
  if (patch.pull && Object.keys(patch.pull).length > 0) update.$pull = patch.pull;
  return update;
}
