/**
 * Turns the fields a plugin stores (core/db/storedFields.ts) into a Mongoose schema
 * definition, for the discriminator its items are read and written through.
 */

import { StoredField, StoredFields } from '../storedFields';

const SCALARS: Record<string, any> = {
  text: String,
  number: Number,
  boolean: Boolean,
  date: Date
};

function toPath(field: StoredField): any {
  if (field.type === 'records') {
    return [toMongooseDefinition(field.fields || {})];
  }

  const path: Record<string, any> = { type: field.type === 'texts' ? [String] : SCALARS[field.type] };
  if (field.required) path.required = true;
  if (field.default !== undefined) path.default = field.default;
  if (field.values) path.enum = field.values;
  if (field.min !== undefined) path.min = field.min;
  if (field.max !== undefined) path.max = field.max;
  return path;
}

export function toMongooseDefinition(fields: StoredFields): Record<string, any> {
  const definition: Record<string, any> = {};
  for (const [name, field] of Object.entries(fields)) definition[name] = toPath(field);
  return definition;
}
