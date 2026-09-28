import mongoose from 'mongoose';

// One line of a list. A list of items only ever holds `item`; a playlist holds the item
// a track belongs to plus the track's own subdocument id, since a track has no existence
// outside the item that carries it.
const entrySchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  track: { type: mongoose.Schema.Types.ObjectId },
  added_at: { type: Date, default: Date.now }
});

const listSchema = new mongoose.Schema({
  // Same deliberate clash as models/Item.ts: a `collection` PATH holding the owning
  // Collection, next to the `collection` OPTION naming the mongo collection. Only ever
  // read through .lean()/.toObject(), never as an accessor on a hydrated document.
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  // Chosen once, at creation: what a list holds decides how it is drawn, so a list
  // never changes from one to the other.
  kind: { type: String, enum: ['items', 'tracks'], default: 'items' },
  // In the order they were arranged, first line first.
  entries: { type: [entrySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' }
}, {
  collection: 'lists',
  suppressReservedKeysWarning: true,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Listing a collection's lists, which is what every list page starts with.
listSchema.index({ collection: 1, updated_at: -1 });
// Clearing a deleted item out of every list that held it.
listSchema.index({ 'entries.item': 1 });

const List = mongoose.model('List', listSchema);

export = List;
