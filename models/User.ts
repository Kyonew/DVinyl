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
    password: {
        type: String,
        required: [true, "auth.password_required"],
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
    lastChange: {
        type: Date,
        default: Date.now
    }
});


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