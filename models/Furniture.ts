import mongoose from 'mongoose';
import { MAX_FURNITURE_COLUMNS, MAX_FURNITURE_ROWS } from '../utils/shelfHelpers';

// One compartment: a cube in a `cubes` layout, a full-width plank in a `rows` one.
// `name` is what items carry in their own `location` field, and is the only thing
// tying a shelf to what stands on it.
const cellSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // Normalized form of `name` (see utils/shelfHelpers.ts). Stored rather than derived
  // so Mongo can index it: it is what keeps two spellings of one shelf from coexisting
  // in a collection.
  key: { type: String, required: true },
  row: { type: Number, required: true, min: 0 },
  column: { type: Number, required: true, min: 0 },
  // Indicative only. It tightens the drawn spines and feeds the "52 / 40" counter, and
  // is never consulted on a write, so an import always lands.
  capacity: { type: Number, default: 0, min: 0 }
}, { _id: false });

const furnitureSchema = new mongoose.Schema({
  // Same deliberate clash as models/Item.ts: a `collection` PATH holding the owning
  // Collection, next to the `collection` OPTION naming the mongo collection. Only ever
  // read through .lean()/.toObject(), never as an accessor on a hydrated document.
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', required: true },
  name: { type: String, required: true, trim: true },
  // 'cubes' draws a grid of square compartments; 'rows' draws stacked full-width
  // planks, which is the same grid with a single column.
  layout: { type: String, enum: ['cubes', 'rows'], default: 'cubes' },
  columns: { type: Number, default: 4, min: 1, max: MAX_FURNITURE_COLUMNS },
  rows: { type: Number, default: 3, min: 1, max: MAX_FURNITURE_ROWS },
  // Order of the furniture pages within a collection, ascending.
  order: { type: Number, default: 100 },
  cells: { type: [cellSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' }
}, {
  collection: 'furniture',
  suppressReservedKeysWarning: true,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Listing a collection's furniture, which is what every shelf page starts with.
furnitureSchema.index({ collection: 1, order: 1 });

// No two cells in one collection may claim the same location, or an item would stand
// on two shelves at once. Same multikey unique index as Collection.shareLinks.token,
// with one trap of its own: an empty `cells` array indexes as a single null entry, so
// two freshly created furniture would collide on (collection, null). The partial
// filter keeps those out of the index until they hold a cell.
//
// It cannot see everything: Mongo dedupes index keys within one document, so two
// identical cells in the SAME furniture still pass. That case is caught in the
// application (see utils/shelfHelpers.ts), and this index covers the rest, including
// two requests racing to create the same shelf.
furnitureSchema.index(
  { collection: 1, 'cells.key': 1 },
  { unique: true, partialFilterExpression: { 'cells.0': { $exists: true } } }
);

const Furniture = mongoose.model('Furniture', furnitureSchema);

export = Furniture;
