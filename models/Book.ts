import mongoose from 'mongoose';
import Item from './Item';

const bookSchema = new mongoose.Schema({
  author: { type: String, required: true },
  hardcover_slug: { type: String, default: '' },
  source: { type: String, enum: ['hardcover', 'goodreads', 'manual'], default: 'manual' },
  publisher: String,
  isbn: String,
  pages: Number,
  language: String,
  format: { 
      type: String, 
      enum: ['hardcover', 'paperback', 'manga', 'comic', 'graphic_novel'],
      default: 'paperback'
  },
  series: String,
  volume: Number,
  
  readingStatus: {
      type: String,
      enum: ['to_read', 'reading', 'read'],
      default: 'to_read'
  },
  rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
  },
  genre: { type: String, default: '' },
  genres: { type: [String], default: [] },
  styles: { type: [String], default: [] }
});

const Book = Item.discriminator('Book', bookSchema);

export = Book;