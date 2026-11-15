import mongoose from 'mongoose';

// One device a member gets push notifications on: what its browser handed over when the
// member turned them on (core/push.ts). Never backed up: a subscription only means
// something to the browser that made it.
const pushSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  // The push service's URL for this device. One device, one row: subscribing again from
  // the same browser, even signed in as someone else, takes the row over.
  endpoint: { type: String, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  // "Chrome · Android", read from the browser when it subscribed, so the list of devices
  // says which is which.
  label: { type: String, default: '' },
  lastSuccessAt: { type: Date, default: null },
  // Sends in a row that failed for a reason other than the device being gone.
  failures: { type: Number, default: 0 }
}, {
  collection: 'push_subscriptions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

pushSubscriptionSchema.index({ user: 1 });
pushSubscriptionSchema.index({ endpoint: 1 });

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

export = PushSubscription;
