import mongoose from 'mongoose';
import Item from './Item';

const gameSchema = new mongoose.Schema({
    developer: { type: String, default: '' },
    publisher: { type: String, default: '' },
    platform: {
        type: String,
        default: 'other'
    },
    igdb_id: Number,
    region: { type: String, default: '' }, // JAP, PAL, NTSC-U, etc. (manual)

    format: {
        type: String,
        enum: ['physical', 'collector', 'limited', 'steelbook'],
        default: 'physical'
    },

    playStatus: {
        type: String,
        enum: ['to_play', 'playing', 'played'],
        default: 'to_play'
    },
    user_rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] },
    styles: { type: [String], default: [] }
});

const Game = Item.discriminator('Game', gameSchema);

export = Game;
