import mongoose from 'mongoose';

const loginLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  // Keep username/email snapshot in case the user account is removed later.
  username: String,
  email: String,
  ip: String,
  country: String, // Country code (e.g. 'FR', 'US')
  city: String,
  userAgent: String, // Browser / OS string
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  timestamp: { type: Date, default: Date.now }
});

export = mongoose.model('LoginLog', loginLogSchema);