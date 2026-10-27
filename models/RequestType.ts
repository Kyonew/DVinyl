import mongoose from 'mongoose';

// A kind of request the admin of a collection made up: a loan, a gift, anything. Every
// request is one member asking another about one item; a type only says what the form
// asks, who sees it, and which steps it goes through once accepted. See core/requests.ts.
const fieldSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: ['text', 'textarea', 'number', 'date', 'select', 'boolean'], default: 'text' },
  required: { type: Boolean, default: false },
  options: { type: [String], default: undefined },
  // A date the request is due by: past it, an ongoing request reads as late.
  deadline: { type: Boolean, default: false }
}, { _id: false });

const stepSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true, trim: true },
  // While the request is at this step, the item is away, with the holder the type names.
  out: { type: Boolean, default: false }
}, { _id: false });

const requestTypeSchema = new mongoose.Schema({
  // Same deliberate clash as models/Item.ts: a `collection` PATH holding the owning
  // Collection, next to the `collection` OPTION naming the mongo collection.
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', required: true },
  // Stored on each request; never changes once the type is made.
  slug: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  icon: { type: String, default: 'paper-plane' },
  description: { type: String, default: '', trim: true },
  enabled: { type: Boolean, default: true },
  // The least role that can send one.
  minRole: { type: String, enum: ['viewer', 'editor', 'admin'], default: 'viewer' },
  // 'members': every member of the collection sees these requests. 'private': only the
  // two members it is between.
  visibility: { type: String, enum: ['members', 'private'], default: 'members' },
  // Who has the item during a step marked `out`: the member who sent the request, or the
  // one who received it. 'none' for a type that never moves an item.
  holder: { type: String, enum: ['none', 'sender', 'recipient'], default: 'none' },
  fields: { type: [fieldSchema], default: [] },
  // In order, after the request is accepted. The last one closes it.
  steps: { type: [stepSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' }
}, {
  collection: 'request_types',
  suppressReservedKeysWarning: true,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

requestTypeSchema.index({ collection: 1, slug: 1 }, { unique: true });

const RequestType = mongoose.model('RequestType', requestTypeSchema);

export = RequestType;
