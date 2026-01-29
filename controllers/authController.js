/**
 * controllers/authController.js
 *
 * Authentication controller: handles rendering the login page, processing
 * login submissions, creating a JWT cookie on success, logging login
 * attempts, rate-limiting repeated failures and logging out users.
 */
const User = require("../models/User");
const jwt = require('jsonwebtoken');
require('dotenv').config();
const LoginLog = require("../models/LoginLog");
const geoip = require('geoip-lite');
const requestIp = require('request-ip');

// In-memory login attempt tracking to throttle brute-force attempts.
const loginAttempts = {};
const MAX_ATTEMPTS = 4;
const BLOCK_TIME = 5 * 60 * 1000; // 5 minutes (can be adjusted as needed)

/**
 * Translate known errors into i18n keys returned to the client.
 * This function handles both manual logic errors and Mongoose validation errors.
 * @param {Error} err - Error thrown by model operations
 * @returns {{login: string}} Object containing the i18n key for the error
 */
const handleErrors = (err) => {
  let errors = { login: '' };

  // Manual check for login logic (custom errors thrown by User.login static method)
  if (err.message === 'incorrect email' || err.message === 'incorrect password') {
    errors.login = 'errors.invalid_credentials';
  }

  // If the error is a validation error, we extract the key defined in the User Schema.
  if (err.message.includes('user validation failed')) {
    Object.values(err.errors).forEach(({ properties }) => {
      // The properties.message contains the i18n key (e.g., "auth.email_required")
      errors.login = properties.message;
    });
  }

  return errors;
};

/**
 * GET /login
 * Render the login page.
 */
module.exports.login_get = (req, res) => {
  res.render('login');
};

/**
 * POST /login
 * Process login form submissions. Implements simple in-memory rate limiting
 * and logs each attempt (success or failure) with geolocation information.
 */
module.exports.login_post = async (req, res) => {
  const { email, password } = req.body;
  const now = Date.now();

  // Check whether this email is temporarily blocked due to repeated failures.
  if (loginAttempts[email] && loginAttempts[email].blockedUntil && now < loginAttempts[email].blockedUntil) {
    const secondsLeft = Math.ceil((loginAttempts[email].blockedUntil - now) / 1000);
    return res.status(429).json({
      errors: { login: req.t('errors.too_many_attempts_timed', { seconds: secondsLeft }) }
    });
  }

  try {
    const user = await User.login(email, password);

    const clientIp = requestIp.getClientIp(req);
    const geo = geoip.lookup(clientIp) || {};

    await LoginLog.create({
      user: user._id,
      username: user.username,
      email: user.email,
      ip: clientIp,
      country: geo.country || 'XX',
      city: geo.city || req.t('common.unknown'),
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    // Clear failed attempts on successful login.
    if (loginAttempts[email]) delete loginAttempts[email];

    const token = jwt.sign({ id: user._id }, process.env.PASSJWT, { expiresIn: '3d' });

    res.cookie('jwt', token, { httpOnly: true, maxAge: 3 * 24 * 60 * 60 * 1000 });
    res.status(200).json({ user: user._id });

  } catch (err) {
    // Increment failure counter for this email address.
    if (!loginAttempts[email]) loginAttempts[email] = { count: 0, lastTry: now };
    loginAttempts[email].count++;
    loginAttempts[email].lastTry = now;

    // If threshold reached, set a temporary block window.
    if (loginAttempts[email].count >= MAX_ATTEMPTS) {
      loginAttempts[email].blockedUntil = now + BLOCK_TIME;
      return res.status(429).json({
        errors: { login: req.t('errors.too_many_attempts_blocked') }
      });
    }

    // Retrieve the error key from handleErrors.
    const errorKeys = handleErrors(err);
    
    // Translate the key returned by the model using the current request language.
    res.status(400).json({
      errors: { login: req.t(errorKeys.login) }
    });
  }
};

/**
 * GET /logout
 */
module.exports.logout_get = (req, res) => {
  res.cookie('jwt', '', { maxAge: 1 });
  res.redirect('/');
};