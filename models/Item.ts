import mongoose from 'mongoose';

const options = {
  discriminatorKey: 'kind',
  collection: 'albums',
  timestamps: { createdAt: false, updatedAt: 'updated_at' },
  // We deliberately use a `collection` PATH (the owning Collection ref) alongside the
  // `collection` OPTION (mongo collection name). Safe here: the path is only read via
  // .lean()/.toObject() results, never as an accessor on a hydrated Document.
  suppressReservedKeysWarning: true
};

const itemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  year: String,
  cover_image: String,
  user_image: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Which collection (shared library) this item belongs to. Not required: the
  // boot-time migration backfills all pre-existing items before the server serves
  // traffic, so requiring it would only turn a missed write-path stamp into a hard 500.
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection' },
  in_wishlist: { type: Boolean, default: false },
  comments: { type: String, default: '' },
  location: { type: String, default: '' },
  quantity: { type: Number, default: 1, min: 1 },
  genre: String,
  genres: [String],
  styles: [String],
  barcode: { type: String, default: '' },
  barcode_locked: { type: Boolean, default: false },
  added_at: { type: Date, default: Date.now }

}, options);

const Item = mongoose.model('Item', itemSchema);

export = Item;