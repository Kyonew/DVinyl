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
    // Set once the boot migration has turned this collection's free-text `location`
    // values into shelves. Its own flag rather than "has no furniture yet", so
    // deleting every piece of furniture on purpose does not bring the seeded ones
    // back on the next restart. A collection created from the app starts with it set:
    // it has no free-text past, every shelf it gets comes from the shelf store. Left
    // unset only where there can be one, the default collection the migration builds
    // around a pre-collection install's items.
    shelvesSeeded: {
        type: Boolean,
        default: false
    },
    // Free-form presentation page for the collection (see core/collectionInfo.ts and
    // core/routes/collectionInfoRoute.ts). Lives on the collection rather than in its
    // Settings container because it is what the collection says about itself, not how
    // the instance is configured to display it.
    info: {
        // Drawn and linked to only when on. Off is the state of a collection that has
        // never written one, so nothing appears until somebody has something to say.
        enabled: { type: Boolean, default: false },
        // Whether a share-link visitor sees it too. A collection can keep a page for
        // its own members while its public link shows nothing.
        shareVisible: { type: Boolean, default: true },
        title: { type: String, default: '', trim: true },
        // Markdown, rendered at display time (core/markdown.ts). Stored as written so
        // an edit reopens on the author's own text.
        body: { type: String, default: '' },
        // Managed upload paths or remote URLs, in display order; same storage as the
        // item galleries (core/itemImageStorage.ts).
        images: { type: [String], default: [] },
        updated_at: { type: Date, default: null }
    },
    members: {
        type: [memberSchema],
        default: []
    },
    // Public, account-free read-only browsing (see routes/shareRoutes.ts and
    // middleware/collectionMiddleware.ts). A collection can have several independent
    // links at once (e.g. one scoped to Vinyls, another to CDs) - each with its own
    // token, so disabling/regenerating/deleting one never touches the others.
    shareLinks: {
        type: [{
            token: { type: String, required: true },
            // Optional friendly name shown in the admin ("Vinyls only"). Purely
            // cosmetic - never rendered to a share visitor.
            label: { type: String, default: '' },
            enabled: { type: Boolean, default: true },
            // Restricts this link to specific plugin types and, within a type, to
            // specific format values (e.g. music -> only 'cd' and 'vinyl'). Empty
            // array = whole collection, every type and format. An entry with an
            // empty `formats` means every format of that one type.
            scope: {
                type: [{
                    pluginId: { type: String, required: true },
                    formats: { type: [String], default: [] }
                }],
                default: []
            }
        }],
        default: []
    }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Multikey unique index: no two links, even across different collections, can ever
// share a token. Sparse so a collection with zero links (empty array) is unaffected.
collectionSchema.index({ 'shareLinks.token': 1 }, { unique: true, sparse: true });

const Collection = mongoose.model('Collection', collectionSchema);

export = Collection;
