const mongoose = require('mongoose');

/**
 * models/LoginLog.js
 *
 * Schema for recording login attempts. Stores a reference to the user
 * (if available) plus snapshot fields (username, email) so logs remain
 * meaningful after user deletion. Includes geolocation, user-agent and
 * a status flag for success/failed attempts.
 */
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

module.exports = mongoose.model('LoginLog', loginLogSchema);