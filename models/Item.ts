import mongoose from 'mongoose';
import { buildSortTitle } from '../core/helpers';

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
  // Sort key derived from `title`, kept in sync by the hooks below. Never written by a
  // caller: it exists only so Mongo can order on a normalized title, since it sorts
  // before it paginates and the rendered page only ever holds one page of results.
  sort_title: { type: String, default: '' },
  year: String,
  cover_image: String,
  user_image: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Which collection (shared library) this item belongs to. Not required: the
  // boot-time migration backfills all pre-existing items before the server serves
  // traffic, so requiring it would only turn a missed write-path stamp into a hard 500.
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection' },
  // Who last changed the item by hand, and when. Deliberately not `updated_at`, which the
  // timestamps option bumps on any write at all: a metadata refresh would then pass for a
  // modification and bury the name of the last person who really touched the item.
  modified_at: Date,
  modified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // When a provider last filled this item's metadata in. Its own field for the same
  // reason, and with no author: nobody decided it.
  synced_at: Date,
  in_wishlist: { type: Boolean, default: false },
  comments: { type: String, default: '' },
  location: { type: String, default: '' },
  quantity: { type: Number, default: 1, min: 1 },
  genre: String,
  genres: [String],
  styles: [String],
  barcode: { type: String, default: '' },
  barcode_locked: { type: Boolean, default: false },
  added_at: { type: Date, default: Date.now },

  // Values of the user-defined fields declared per collection in
  // settings.pluginExtraFields. Deliberately schemaless: the definitions are scoped
  // to a collection while the Mongoose discriminators are process-wide, so a typed
  // path could not express "this field exists on Music in collection A only".
  // Reads go through the plugin decoration layer, which knows the declared type.
  extra: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }

}, options);

// Titles are written from a lot of places: the add and edit forms, the CSV and Libib
// importers, metadata refreshes, bulk edits and backup restores. Deriving `sort_title` in
// schema middleware keeps the two in sync without asking each of those to remember, and
// the discriminators inherit these hooks as long as they are declared before the model.
itemSchema.pre('save', function (this: any, next) {
  if (this.isModified('title')) this.sort_title = buildSortTitle(this.title);
  next();
});

itemSchema.pre('insertMany', function (next: any, docs: any[]) {
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (doc && typeof doc.title === 'string') doc.sort_title = buildSortTitle(doc.title);
  }
  next();
});

// A title reaches an update either inside $set or at the top level of a plain update
// object; mixing the two forms in one payload is what Mongo rejects, so follow the shape
// that is already there.
function stampSortTitleOnUpdate(this: any, next: any): void {
  const update = this.getUpdate();
  if (!update || Array.isArray(update)) return next();

  const title = update.$set?.title ?? update.title;
  if (typeof title === 'string') {
    const sortTitle = buildSortTitle(title);
    if (Object.keys(update).some(key => key.startsWith('$'))) {
      update.$set = { ...(update.$set || {}), sort_title: sortTitle };
    } else {
      update.sort_title = sortTitle;
    }
    this.setUpdate(update);
  }
  next();
}

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate'] as const) {
  itemSchema.pre(op, stampSortTitleOnUpdate);
}

const Item = mongoose.model('Item', itemSchema);

export = Item;