import mongoose from 'mongoose';

// One member asking another about one item, under one of the collection's request types
// (models/RequestType.ts). It waits for the recipient's answer, then goes through the
// type's steps; see core/requests.ts.
const requestSchema = new mongoose.Schema({
  // Same deliberate clash as models/Item.ts: a `collection` PATH holding the owning
  // Collection, next to the `collection` OPTION naming the mongo collection. Only ever
  // read through .lean()/.toObject(), never as an accessor on a hydrated document.
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', required: true },
  // The slug of its type. Kept as written even once the type is gone: the snapshot below
  // still says what it was.
  type: { type: String, required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  // Copied from the type when sent, so who may read it never depends on a later edit.
  visibility: { type: String, enum: ['members', 'private'], default: 'members' },
  // 'pending': waiting for the recipient. 'accepted': going through the steps. 'done':
  // past the last one. 'declined' and 'cancelled' close it early.
  status: { type: String, enum: ['pending', 'accepted', 'declined', 'cancelled', 'done'], default: 'pending' },
  // Index of the step reached in snapshot.steps; -1 until the first one.
  step: { type: Number, default: -1 },
  message: { type: String, default: '', trim: true },
  // The answers to the type's fields, checked against them when the request was sent.
  data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // The recipient's word when answering.
  response: { type: String, default: '', trim: true },
  // What happened to it, oldest first: [{ at, by, action, step }].
  log: { type: mongoose.Schema.Types.Mixed, default: () => [] },
  // How the type read when the request was sent: { name, icon, holder, fields, steps }.
  snapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // When both members were told it is past its due date, so they are told once.
  overdueNotifiedAt: { type: Date, default: null }
}, {
  collection: 'requests',
  suppressReservedKeysWarning: true,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// The inbox of a member, and the requests about one item.
requestSchema.index({ collection: 1, recipient: 1, status: 1 });
requestSchema.index({ item: 1, status: 1 });

const Request = mongoose.model('Request', requestSchema);

export = Request;
