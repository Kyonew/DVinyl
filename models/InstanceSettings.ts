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
    },
    // AI assist, configured by an instance admin. The API key is stored encrypted
    // (see core/ai/secret.ts); the AI_* environment variables override these values.
    ai: {
        enabled: { type: Boolean, default: false },
        provider: { type: String, default: 'openrouter' },
        // Only meaningful for the 'custom' provider; the presets supply their own.
        baseUrl: { type: String, default: '' },
        model: { type: String, default: '' },
        visionModel: { type: String, default: '' },
        apiKeyEncrypted: { type: String, default: '' }
    },
    // The instance's own VAPID keys, made on first use (core/push.ts). The private key is
    // stored encrypted, like the AI key; one that no longer decrypts is replaced.
    push: {
        publicKey: { type: String, default: '' },
        privateKeyEncrypted: { type: String, default: '' },
        // The contact the keys are signed with: the HTTPS address members turned push on
        // from. Apple's push service refuses a token whose contact is not a real one.
        subject: { type: String, default: '' }
    },
    // Whether the instance asks GitHub once a day for the latest release, and what it
    // learnt: off until an admin turns it on, since it is a call outside the instance.
    updateCheck: {
        enabled: { type: Boolean, default: false },
        latest: { type: String, default: '' },
        url: { type: String, default: '' },
        checkedAt: { type: Date, default: null },
        // The release the admins were last told about, so each one is told once.
        notified: { type: String, default: '' }
    }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export = mongoose.model('InstanceSettings', instanceSettingsSchema);
