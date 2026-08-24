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
});

priceHistorySchema.index({ collection: 1, capturedAt: 1 });

export = mongoose.model('PriceHistory', priceHistorySchema);
