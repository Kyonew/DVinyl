import mongoose from 'mongoose';

// A member of a collection. Role is enforced by middleware/authMiddleware.ts's
// requireCollectionRole (viewer < editor < admin).
const memberSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'editor', 'viewer'],
        default: 'viewer'
    }
}, { _id: false });

const collectionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        required: true,
        unique: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    // Marks the single collection created by the data migration / first-run setup.
    // Lets the migration and the self-heal middleware find it idempotently.
    isDefault: {
        type: Boolean,
        default: false
    },
    members: {
        type: [memberSchema],
        default: []
    }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const Collection = mongoose.model('Collection', collectionSchema);

export = Collection;
