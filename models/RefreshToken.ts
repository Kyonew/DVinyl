import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  // sha256 of the opaque refresh token. The plaintext token is returned to the
  // client once and never stored - only its hash, so a DB read alone can't
  // impersonate a device.
  tokenHash: { type: String, required: true, unique: true },
  deviceLabel: { type: String, default: 'Unknown device' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: Date.now }
});

// TTL index: Mongo garbage-collects expired rows itself instead of them
// piling up forever for devices that never explicitly log out.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export = mongoose.model('RefreshToken', refreshTokenSchema);
