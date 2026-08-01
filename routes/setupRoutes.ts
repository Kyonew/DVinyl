import express from 'express';
import User from '../models/User';
import Collection from '../models/Collection';
import { generateUniqueSlug } from '../utils/collectionHelpers';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { normalizeLanguage } from '../config/constants';

const router = express.Router();

const maxAge = 3 * 24 * 60 * 60;
const createToken = (id: any) => {
    const passjwt = process.env.PASSJWT;

    if (!passjwt) {
        throw new Error('Missing PASSJWT environment variable');
    }

    return jwt.sign({ id }, passjwt, {
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
        const { username, email, password, language } = req.body;

        // Create the initial admin user (isAdmin: true)
        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = await User.create({
            username,
            email,
            password: password,
            isAdmin: true,
            // The form posts whatever the page was rendered in, and the field is client
            // side: normalized rather than trusted, or the enum rejects the whole document
            // and the instance cannot be installed at all.
            language: normalizeLanguage(language || req.language),
            lastChange: new Date()
        });

        // Force-update the stored password hash
        await User.updateOne({ _id: newAdmin._id }, { $set: { password: hashedPassword } });

        // Create the default collection for the first admin (migrate.ts can't have done this
        // at boot: there were zero users then). The admin becomes its first member/owner.
        const collection = await Collection.create({
            name: 'Vinyl',
            slug: await generateUniqueSlug('Vinyl'),
            createdBy: newAdmin._id,
            isDefault: true,
            members: [{ user: newAdmin._id, role: 'admin' }]
        });
        await User.updateOne(
            { _id: newAdmin._id },
            { $set: { lastActiveCollectionId: collection._id } }
        );

        // Issue JWT and set cookie
        const token = createToken(newAdmin._id);
        res.cookie('jwt', token, {
            httpOnly: true,
            maxAge: 3 * 24 * 60 * 60 * 1000,
            secure: process.env.PROD === 'true', // Only send cookie over HTTPS in production
            sameSite: 'lax' // Mitigate CSRF
        });
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.render('setup', { error: req.t('errors.setup_error') });
    }
});

export = router;