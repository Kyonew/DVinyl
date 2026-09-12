import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const isEmail = (val: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
};

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, "auth.username_required"],
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: [true, "auth.email_required"],
        unique: true,
        lowercase: true,
        validate: [isEmail, "auth.email_invalid"]
    },
    // Required for local (password) accounts only. Accounts provisioned through
    // an identity provider have `oidc.sub` set and no local password: they can
    // only sign in through SSO. See the guard in `login()` below.
    password: {
        type: String,
        required: [function (this: any) { return !this.oidc?.sub; }, "auth.password_required"],
        minlength: [6, "auth.password_too_short"]
    },
    img: {
        type: String,
        default: "/ressources/no-pp.jpg"
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    theme: {
        type: String,
        default: 'dark',
        enum: ['light', 'dark']
    },
    language: {
        type: String,
        enum: ['fr', 'en', 'de', 'es', 'it'],
        default: 'fr'
    },
    currency: {
        type: String,
        enum: ['EUR', 'USD', 'GBP'],
        default: 'USD'
    },
    // Plugin-scoped user data: { [pluginId]: { [key]: value } }, e.g. { music: { discogsUsername: 'foo' } }.
    // Lets a plugin persist per-user state without adding a field to the core User model.
    pluginData: { type: mongoose.Schema.Types.Mixed, default: {} },
    // The collection this user is currently browsing. Persisted (not session-only)
    // so it survives logout / a new browser / another device.
    lastActiveCollectionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Collection',
        default: null
    },
    // Where opening the app puts the user. Separate from lastActiveCollectionId, which
    // follows them around while they browse: this one is a choice, applied when a
    // session starts and never touched by the collection switcher afterwards.
    // Null means "wherever I left off".
    homeCollectionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Collection',
        default: null
    },
    homePage: {
        type: String,
        enum: ['dashboard', 'collection', 'wishlist'],
        default: 'dashboard'
    },
    // Id of a view in core/viewRegistry.ts, applied to the landing page when it is the
    // collection or the wishlist. Not an enum: views are registered at runtime, and an
    // id that stops resolving falls back to the grid like any other stale choice.
    // Empty means the browser's own last-used view.
    homeView: {
        type: String,
        default: ''
    },
    // OIDC identity linked from the Settings page. Optional: password login
    // always remains available. `sub` is the subject claim issued by the
    // identity provider and identifies the external account.
    oidc: {
        sub: { type: String },
        linkedAt: { type: Date },
        // True when the account was created automatically on first SSO login
        // (JIT provisioning) rather than linked from an existing local account.
        autoProvisioned: { type: Boolean }
    },
    lastChange: {
        type: Date,
        default: Date.now
    }
});

// An OIDC identity can only be linked to one account. The index is sparse so
// that users without a linked identity do not collide on the missing field.
userSchema.index({ 'oidc.sub': 1 }, { unique: true, sparse: true });


/**
 * Authenticate a user by email and password.
 * Throws an Error with message 'incorrect email' or 'incorrect password'
 * which is handled by the calling controller.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<mongoose.Document>} Resolves with the user document on success
 */
userSchema.statics.login = async function (email, password) {
    const user = await this.findOne({ email });
    if (user) {
        // SSO-only accounts have no local password: reject the password login
        // path cleanly instead of letting bcrypt.compare throw on an undefined
        // hash. These users must authenticate through their identity provider.
        if (!user.password) {
            throw Error('incorrect password');
        }
        const auth = await bcrypt.compare(password, user.password);
        if (auth) {
            return user;
        }
        throw Error('incorrect password');
    }
    throw Error('incorrect email');
};

const User = mongoose.model('user', userSchema);

export = User;