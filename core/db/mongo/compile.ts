/**
 * Turns core filters and sorts (core/db/filter.ts) into MongoDB queries.
 *
 * The only place that knows what a core filter means to Mongo. Ids stay text here: the
 * model a query runs through casts them, as it does for any value of a declared path.
 */

import { Types } from 'mongoose';
import { Filter, Sort } from '../filter';
import { Patch } from '../patch';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Ids are stored as ObjectIds. A model casts the ids of the paths it declares, but not
// those of a record list a plugin declares (`tracklist._id` read through the base item
// model), so an id-shaped value on an id path is cast here, whatever the path.
function idValue(field: string, value: any): any {
  const isIdPath = field === '_id' || field.endsWith('._id');
  return isIdPath && typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value) ? new Types.ObjectId(value) : value;
}

const MONGO_TYPES: Record<string, string> = {
  text: 'string', number: 'number', boolean: 'bool', date: 'date', list: 'array', record: 'object'
};

export function toMongoFilter(filter: Filter): Record<string, any> {
  switch (filter.op) {
    case 'all': return {};
    case 'none': return { _id: { $in: [] } };
    case 'and': return { $and: filter.filters.map(toMongoFilter) };
    case 'or': return { $or: filter.filters.map(toMongoFilter) };
    case 'not': return { $nor: [toMongoFilter(filter.filter)] };
    case 'eq': return { [filter.field]: idValue(filter.field, filter.value) };
    case 'in': return { [filter.field]: { $in: filter.values.map(value => idValue(filter.field, value)) } };
    case 'ci': return { [filter.field]: new RegExp(`^${escapeRegExp(filter.value)}$`, 'i') };
    case 'contains': return { [filter.field]: new RegExp(escapeRegExp(filter.value), 'i') };
    case 'missing': return { [filter.field]: { $exists: false } };
    case 'blank': return { [filter.field]: { $in: [null, '', []] } };
    case 'sameAs': return { $expr: { $eq: [`$${filter.field}`, `$${filter.other}`] } };
    case 'type': return { [filter.field]: { $type: MONGO_TYPES[filter.type] } };
    case 'size': return { [filter.field]: { $size: filter.size } };
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
  if (patch.pull && Object.keys(patch.pull).length > 0) {
    update.$pull = Object.fromEntries(Object.entries(patch.pull).map(([field, value]) =>
      [field, value && typeof value === 'object' && 'op' in (value as any) ? toMongoFilter(value as Filter) : value]));
  }
  return update;
}
