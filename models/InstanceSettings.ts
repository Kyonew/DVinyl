import mongoose from 'mongoose';

/**
 * Singleton document holding instance-wide settings (as opposed to models/Settings.ts,
 * which is scoped per collection). Read through utils/instanceSettings.ts, which caches
 * it in memory: this is consulted on nearly every request.
 *
 * `key` is a fixed discriminator with a unique index, so concurrent upserts can never
 * end up creating a second document.
 */
const instanceSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'instance',
        unique: true,
        immutable: true
    },
    // When true, ordinary members (not just instance admins) may create their own
    // collection from the UI. They become 'admin' of what they create.
    allowMemberCollectionCreation: {
        type: Boolean,
        default: false
    },
    // How many collections a single non-admin user may own (counted on Collection.createdBy).
    // Only enforced while allowMemberCollectionCreation is true; instance admins are exempt.
    maxCollectionsPerUser: {
        type: Number,
        default: 1,
        min: 1,
        max: 100
    }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export = mongoose.model('InstanceSettings', instanceSettingsSchema);
