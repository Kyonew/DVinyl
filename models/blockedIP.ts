import mongoose from 'mongoose';

const blockedIPSchema = new mongoose.Schema({
  ip: {
    type: String,
    required: true,
    unique: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export = mongoose.model('BlockedIP', blockedIPSchema);