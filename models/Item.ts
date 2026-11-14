import mongoose from 'mongoose';
import { buildSortTitle } from '../core/helpers';
import { sortArticlesFor } from '../core/sortArticles';
import { allCreatorFields, buildSortCreator, creatorFieldOf, sortCreatorOf } from '../core/sortCreators';

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
  // The same for the item's creator (core/sortCreators.ts), which field that is depending
  // on its type.
  sort_creator: { type: String, default: '' },
  year: String,
  cover_image: String,
  user_image: String,
  // Ordered gallery shared by every plugin. The first two entries are mirrored to
  // cover_image/user_image on form saves for compatibility with existing integrations.
  images: { type: [String], default: undefined },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The item holding this one, when it is contained rather than standalone: a season of a
  // show points at the show. A contained item is a full item, with its own cover, year and
  // metadata; it is simply reached from its holder instead of from the grid. Absent on
  // everything else, which is what makes the filter a plain $exists.
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
  // The box this item is kept in, if any (core/insideItems.ts): a film of a boxset.
  inside: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
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
  // What the owner paid for this copy, in the currency of the member who entered it,
  // which is kept beside it: members of one collection may count in different
  // currencies, and an amount is never compared with one in another (see the estimates).
  purchase_price: { type: Number, min: 0 },
  purchase_currency: String,
  // Images kept on this server that were downloaded from elsewhere (core/imageDownload.ts):
  // which address each local file came from, so a refresh bringing the same address back
  // keeps the copy, and the addresses that could not be fetched, not tried again on their own.
  image_origins: { type: [{ _id: false, file: String, url: String }], default: undefined },
  image_download_failed: { type: [String], default: undefined },
  // The other formats this edition holds besides its own, for a type that allows it
  // (see core/extraFormats.ts).
  extra_formats: { type: [String], default: undefined },
  quantity: { type: Number, default: 1, min: 1 },
  genre: String,
  genres: [String],
  styles: [String],
  barcode: { type: String, default: '' },
  barcode_locked: { type: Boolean, default: false },

  // Which external source filled this item in, and the id it carries over there. Kept
  // next to each other because neither means anything alone: two databases hand out the
  // same numbers for unrelated things, so only the pair identifies a record.
  //
  // The plugins' own typed id paths (discogs_id, igdb_id...) stay written exactly as
  // before: they are what the price estimates, the duplicate lookups and the external
  // links have always read. This pair is what lets an item say where it came from when
  // that is not the plugin's historical provider.
  //
  // Stored as text whatever the source's own type: it is an opaque reference here, and
  // a source is free to hand out slugs.
  source: { type: String, default: '' },
  source_id: { type: String, default: '' },
  // The fields the owner changed by hand, which a metadata refresh leaves alone, and what
  // the source said about them on the last refresh, offered back by the edit form. See
  // core/keptFields.ts.
  kept_fields: { type: [String], default: undefined },
  // Paths an import already filled in, so a value emptied since is not brought back.
  import_filled: { type: [String], default: undefined },
  source_values: { type: mongoose.Schema.Types.Mixed, default: undefined },
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
  if (this.isModified('title') || this.isModified('collection')) this.sort_title = buildSortTitle(this.title, sortArticlesFor(this.collection));
  const creator = creatorFieldOf(this.kind);
  if (creator && (this.isNew || this.isModified(creator) || this.isModified('collection'))) {
    this.sort_creator = buildSortCreator(this.get(creator), sortArticlesFor(this.collection));
  }
  next();
});

itemSchema.pre('insertMany', function (next: any, docs: any[]) {
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!doc) continue;
    if (typeof doc.title === 'string') doc.sort_title = buildSortTitle(doc.title, sortArticlesFor(doc.collection));
    doc.sort_creator = sortCreatorOf(doc, sortArticlesFor(doc.collection));
  }
  next();
});

// A title or a creator reaches an update either inside $set or at the top level of a
// plain update object; mixing the two forms in one payload is what Mongo rejects, so
// follow the shape that is already there.
//
// The articles dropped are the item's collection's, read off the filter when it names the
// collection and off the stored item otherwise. The creator field is the item's type's.
const valueIn = (update: any, field: string) => update.$set?.[field] ?? update[field];
const touches = (update: any, field: string) =>
  valueIn(update, field) !== undefined || Boolean(update.$unset && field in update.$unset);
const writesSortSource = (update: any) =>
  touches(update, 'title') || allCreatorFields().some(field => touches(update, field));
const isId = (value: any) => value != null && (typeof value !== 'object' || Boolean(value._bsontype));

/** updateOne and findOneAndUpdate: one item, whose keys go into the same write. */
async function stampSortKeysOnUpdate(this: any): Promise<void> {
  const update = this.getUpdate();
  if (!update || Array.isArray(update) || !writesSortSource(update)) return;

  // An update made through a type's own model only ever reaches items of that type. A
  // kind in the filter counts only as a plain value, not as an operator like $in.
  const filterKind = this.getFilter()?.kind;
  let kind = valueIn(update, 'kind') ?? (typeof filterKind === 'string' ? filterKind : undefined)
    ?? (this.model.modelName !== 'Item' ? this.model.modelName : undefined);
  let collection = valueIn(update, 'collection') ?? this.getFilter()?.collection;
  if (!isId(collection) || typeof kind !== 'string') {
    const stored = await this.model.findOne(this.getFilter()).select('collection kind').lean();
    if (!isId(collection)) collection = stored?.collection;
    if (typeof kind !== 'string') kind = stored?.kind ?? '';
  }

  const articles = sortArticlesFor(collection);
  const keys: Record<string, string> = {};
  const title = valueIn(update, 'title');
  if (typeof title === 'string') keys.sort_title = buildSortTitle(title, articles);
  const creator = creatorFieldOf(kind);
  if (creator && touches(update, creator)) keys.sort_creator = buildSortCreator(valueIn(update, creator), articles);
  if (Object.keys(keys).length === 0) return;

  if (Object.keys(update).some(key => key.startsWith('$'))) {
    update.$set = { ...(update.$set || {}), ...keys };
  } else {
    Object.assign(update, keys);
  }
  this.setUpdate(update);
}

/**
 * updateMany: the items may span types and collections, so no single key fits them all.
 * The matched items are noted before the write and their keys derived from what each
 * one stores after it.
 */
async function noteItemsToResort(this: any): Promise<void> {
  const update = this.getUpdate();
  if (!update || Array.isArray(update) || !writesSortSource(update)) return;
  const ids = await this.model.find(this.getFilter()).distinct('_id');
  if (ids.length > 0) this._resortIds = ids;
}

async function resortNotedItems(this: any): Promise<void> {
  const ids = this._resortIds;
  if (!ids) return;
  const items = await this.model.collection
    .find({ _id: { $in: ids } }, { projection: { title: 1, collection: 1, kind: 1, sort_title: 1, sort_creator: 1, ...Object.fromEntries(allCreatorFields().map(f => [f, 1])) } })
    .toArray();
  const ops: any[] = [];
  for (const item of items) {
    const articles = sortArticlesFor(item.collection);
    const set: Record<string, string> = {};
    if (typeof item.title === 'string') {
      const title = buildSortTitle(item.title, articles);
      if (item.sort_title !== title) set.sort_title = title;
    }
    const creator = sortCreatorOf(item, articles);
    if ((item.sort_creator ?? '') !== creator) set.sort_creator = creator;
    if (Object.keys(set).length > 0) ops.push({ updateOne: { filter: { _id: item._id }, update: { $set: set } } });
  }
  if (ops.length > 0) await this.model.collection.bulkWrite(ops);
}

for (const op of ['updateOne', 'findOneAndUpdate'] as const) {
  itemSchema.pre(op, stampSortKeysOnUpdate);
}
itemSchema.pre('updateMany', noteItemsToResort);
itemSchema.post('updateMany', resortNotedItems);

const Item = mongoose.model('Item', itemSchema);

export = Item;
