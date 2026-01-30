const mongoose = require('mongoose');

/**
 * models/Album.js
 *
 * Mongoose schema for an album entry. Supports basic metadata for
 * physical media (vinyl, CD, cassette), an optional tracklist, cover
 * images and an owner reference.
 */
const albumSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  year: String,
  label: String, // e.g. "Columbia"
  catalog_number: String, // e.g. "COL 12345"
  media_type: {
    type: String,
    enum: ['vinyl', 'cd', 'cassette'],
    default: 'vinyl'
  },
  // Physical format/type separate from the media_type enum above.
  // Example: "Vinyl", "LP", "7\""
  format_type: { type: String, default: 'Vinyl' },
  variant_color: String, // e.g. "Red Translucent"
  comments: { type: String, default: '' },

  /**
   * Tracklist array of subdocuments.
   * - position: track position (A1, B2, 1, 2...)
   * - title: track title
   * - duration: optional duration string (e.g. "3:45")
   */
  tracklist: [{
    position: String,
    title: String,
    duration: String
  }],
  location: {
    type: String,
    default: '' // e.g. "Living Room Shelf"
  },
  cover_image: String, // Cover image URL (e.g. from Discogs)
  user_image: String, // URL
  in_wishlist: { type: Boolean, default: false },
  discogs_id: Number,
  added_at: { type: Date, default: Date.now },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const Album = mongoose.model('Album', albumSchema);
module.exports = Album;