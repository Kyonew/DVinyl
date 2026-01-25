const mongoose = require('mongoose');

/**
 * models/blockedIP.js
 *
 * Simple schema to store blocked IP addresses. Intended for short-term
 * blocking of abusive clients (e.g. after repeated failed logins).
 */
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

module.exports = mongoose.model('BlockedIP', blockedIPSchema);