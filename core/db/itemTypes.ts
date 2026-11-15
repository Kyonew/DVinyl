/**
 * Item types: what each one stores (core/db/storedFields.ts), as the rules its items are
 * cast, defaulted and checked with. Shared by every store, whatever keeps the records.
 */

import mongoose from 'mongoose';
import Item from '../../models/Item';
import { toMongooseDefinition } from './mongo/schema';
import { firstInvalid } from './errors';
import type { StoredFields } from './storedFields';

// The model of one item type, which knows its stored fields, or the base one.
export function modelFor(kind?: string): any {
  return kind && mongoose.modelNames().includes(kind) ? mongoose.model(kind) : Item;
}


/** Why the item would be refused by its type, without storing it, or null. */
export function validate(record: Record<string, any>): { field: string; message: string } | null {
  const Model: any = (Item as any).discriminators?.[record.kind] || Item;
  return firstInvalid(new Model(record).validateSync());
}

/** The fields every item has, whatever its type. */
export function baseFieldNames(): string[] {
  return [...new Set(Object.keys(Item.schema.paths).map(path => path.split('.')[0]!))];
}

/**
 * Declares an item type, so its items are read and written with its stored fields.
 * Throws for a type already declared: drop it first (a custom plugin edited at runtime).
 */
export function registerType(kind: string, fields: StoredFields): void {
  Item.discriminator(kind, new mongoose.Schema(toMongooseDefinition(fields)));
}

export function unregisterType(kind: string): void {
  if ((Item as any).discriminators?.[kind]) delete (Item as any).discriminators[kind];
  if (mongoose.modelNames().includes(kind)) mongoose.deleteModel(kind);
}
