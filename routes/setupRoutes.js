/**
 * routes/setupRoutes.js
 *
 * Initial setup routes used to create the first admin user. This module
 * exposes GET/POST handlers for `/setup`. In normal operation this route
 * should be disabled or removed after the initial admin account is created.
 */
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');


const maxAge = 3 * 24 * 60 * 60;
const createToken = (id) => {
    return jwt.sign({ id }, process.env.PASSJWT, {
        expiresIn: maxAge
    });
}

// GET /setup - render initial setup page if no users exist
router.get('/', async (req, res) => {
    const count = await User.countDocuments();
    if (count > 0) return res.redirect('/login'); // safety: only allow setup when DB empty
    res.render('setup', { error: null });
});

// POST /setup - create initial admin user and issue a JWT
router.post('/', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Create the initial admin user (isAdmin: true)
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newAdmin = await User.create({
            username,
            email,
            password: password, 
            isAdmin: true,
            lastChange: new Date()
        });

        // Force-update the stored password hash
        await User.updateOne({ _id: newAdmin._id }, { $set: { password: hashedPassword } });

        // Issue JWT and set cookie
        const token = createToken(newAdmin._id);
        res.cookie('jwt', token, { 
            httpOnly: true, 
            maxAge: 3 * 24 * 60 * 60 * 1000,
            secure: process.env.NODE_ENV === 'production', // Only send cookie over HTTPS in production
            sameSite: 'lax' // Mitigate CSRF
        });        
        res.redirect('/'); 
    } catch (err) {
        console.error(err);
        res.render('setup', { error: req.t('errors.setup_error') });    
    }
});

module.exports = router;