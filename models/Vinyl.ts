import mongoose from 'mongoose';
import Item from './Item';

const vinylSchema = new mongoose.Schema({
  artist: { type: String, required: true },
  label: String,
  catalog_number: String,
  genre: { type: String, default: '' },
  genres: { type: [String], default: [] },
  styles: { type: [String], default: [] },

  media_type: {
    type: String,
    enum: ['vinyl', 'cd', 'cassette'],
    default: 'vinyl'
  },
  format_type: { type: String, default: 'Vinyl' },
  variant_color: String,
  sleeve_condition: { type: String, default: '' },
  discogs_id: Number,
  country: { type: String, default: '' },
  tracklist: [{ position: String, title: String, duration: String }],
});

const Vinyl = Item.discriminator('Music', vinylSchema);

export = Vinyl;