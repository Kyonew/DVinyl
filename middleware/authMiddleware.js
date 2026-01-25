const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();

/**
 * Middleware: requireAuth
 * Verifies a JWT from the request cookies and attaches the corresponding
 * user document to `req.user`. If the token is invalid or the user no
 * longer exists (or changed password), the middleware clears the cookie
 * and redirects to the login page.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requireAuth = async (req, res, next) => {
  const token = req.cookies.jwt;

  if (token) {
    jwt.verify(token, process.env.PASSJWT, async (err, decodedToken) => {
      if (err) {
        console.log(err.message);
        return res.redirect('/login');
      } else {
        // Retrieve the user and attach it to req.user
        const user = await User.findById(decodedToken.id);
        if (!user || (user && user.lastChange && decodedToken.iat * 1000 < user.lastChange.getTime())) {
          if (res.cookie('jwt')) res.cookie('jwt', '', { maxAge: 1 });
          return res.redirect('/login');
        }
        req.user = user; // Attach the user to req.user
        next();
      }
    });
  } else {
    res.redirect('/login');
  }
};

/**
 * Middleware: checkUser
 * Populates `res.locals.user` and `res.locals.isAdmin` for templates.
 * If no valid token is present, `res.locals.user` is null.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const checkUser = (req, res, next) => {

  const token = req.cookies.jwt;

  res.locals.user = null;
  res.locals.isAdmin = false;

  if (token) {
    jwt.verify(token, process.env.PASSJWT, async (err, decodedToken) => {
      if (err) {
        res.locals.user = null;
        next();
      } else {
        let user = await User.findById(decodedToken.id);
        res.locals.user = user;

        if (user && user._id.toString() === process.env.ADMIN_ID) {
            res.locals.isAdmin = true;
        }

        next();
      }
    });
  } else {
    res.locals.user = null;
    next();
  }
};

/**
 * Middleware: requireAdmin
 * Ensures the current request is performed by an admin user. Relies on
 * `checkUser` having populated `res.locals.user` beforehand.
 * Redirects to home if the user is not an admin.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requireAdmin = (req, res, next) => {
    const user = res.locals.user;

    if (user && user.isAdmin === true) {
        next(); // Admin, allow
    } else {
        res.redirect('/'); // Not admin, redirect
    }
};

module.exports = { requireAuth, checkUser, requireAdmin };