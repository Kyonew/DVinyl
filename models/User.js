const mongoose = require('mongoose');
const { isEmail } = require('validator');
const bcrypt = require('bcrypt');

/**
 * models/User.js
 *
 * Mongoose schema for application users and authentication helpers.
 */
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
        default: 'dark', // Default to dark theme
        enum: ['light', 'dark']
    },
    language: { 
        type: String, 
        enum: ['fr', 'en'], 
        default: 'fr' 
    },
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
userSchema.statics.login = async function(email, password) {
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

module.exports = User;