import mongoose from 'mongoose';

const priceHistorySchema = new mongoose.Schema({
  collection: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collection',
    required: true
  },
  capturedAt: { type: Date, default: Date.now },
  value: { type: Number, required: true },
  minValue: { type: Number, required: true },
  maxValue: { type: Number, required: true },
  currency: { type: String, required: true },
  itemCount: { type: Number, required: true }
}, {
  // `collection` is a reserved Mongoose pathname. Storage and queries work, and nothing here
  // reads it off a hydrated document, so the warning is noise: silenced the same way as the
  // Item and Settings schemas, which carry the same field.
  suppressReservedKeysWarning: true
});

priceHistorySchema.index({ collection: 1, capturedAt: 1 });

export = mongoose.model('PriceHistory', priceHistorySchema);
