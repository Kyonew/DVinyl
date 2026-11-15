import mongoose from 'mongoose';

// One line of a member's inbox. It holds ids and names as they were, never text already
// translated: core/notify.ts words it in the reader's language when it is shown.
const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  // The collection it happened in, so the inbox can switch to it before opening the link.
  collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', default: null },
  event: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Where opening it leads, inside the app.
  link: { type: String, default: '' },
  readAt: { type: Date, default: null }
}, {
  collection: 'notifications',
  suppressReservedKeysWarning: true,
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

notificationSchema.index({ user: 1, readAt: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

export = Notification;
