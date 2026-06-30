const express = require('express');
const router = express.Router();
const axios = require('axios');
const Game = require('../models/Game');
const Item = require('../models/Item');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { igdbRequest } = require('../utils/igdbHelper');

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function getAdminId() {
    const admin = await User.findOne({ isAdmin: true }).select('_id');
    return admin ? admin._id : null;
}

async function findDuplicateGame(ownerId, igdbId, title, platform, format) {
    const matchPlatform = platform || 'other';
    const matchFormat = format || 'physical';

    if (igdbId) {
        const query = {
            owner: ownerId,
            in_wishlist: false,
            kind: 'Game',
            igdb_id: parseInt(igdbId)
        };
        if (matchPlatform) {
            query.platform = matchPlatform;
        } else {
            query.$or = [
                { platform: { $exists: false } },
                { platform: "" }
            ];
        }
        const item = await Item.findOne(query);
        if (item) return item;
    }

    const matchTitle = (title || '').trim();

    const query = {
        owner: ownerId,
        in_wishlist: false,
        kind: 'Game',
        title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };

    if (matchPlatform) {
        query.platform = matchPlatform;
    } else {
        query.$or = [
            { platform: { $exists: false } },
            { platform: "" }
        ];
    }

    if (matchFormat) {
        query.format = matchFormat;
    } else {
        if (!query.$or) {
            query.$or = [
                { format: { $exists: false } },
                { format: "" }
            ];
        } else {
            query.$and = [
                { $or: [{ platform: { $exists: false } }, { platform: "" }] },
                { $or: [{ format: { $exists: false } }, { format: "" }] }
            ];
            delete query.$or;
        }
    }

    return await Item.findOne(query);
}

/**
 * Format an IGDB game result for display in search results.
 */
const formatIGDBResult = (game) => {
    let cover = '/ressources/no_file.png';
    if (game.cover && game.cover.url) {
        cover = game.cover.url.replace('t_thumb', 't_cover_big');
        if (cover.startsWith('//')) cover = 'https:' + cover;
    }

    const platforms = (game.platforms || []).map(p => p.name).join(', ');

    let year = '';
    if (game.first_release_date) {
        year = new Date(game.first_release_date * 1000).getFullYear().toString();
    }

    let developer = '';
    let publisher = '';
    if (game.involved_companies) {
        const devCompany = game.involved_companies.find(ic => ic.developer);
        const pubCompany = game.involved_companies.find(ic => ic.publisher);
        if (devCompany && devCompany.company) developer = devCompany.company.name;
        if (pubCompany && pubCompany.company) publisher = pubCompany.company.name;
    }

    return {
        igdb_id: game.id,
        title: game.name || 'Unknown',
        year,
        cover_image: cover,
        platforms_text: platforms,
        platforms: (game.platforms || []).map(p => ({ id: p.id, name: p.name })),
        developer,
        publisher,
        genres: (game.genres || []).map(g => g.name),
        summary: game.summary || ''
    };
};

// ─── ADD GAME (search page) ─────────────────────────────────
router.get('/add-game', requireAuth, requireAdmin, (req, res) => {
    res.render('add-game', { results: null, user: res.locals.user, currentType: 'add-game' });
});

// ─── SEARCH GAMES (IGDB) ────────────────────────────────────
router.post('/search-games', requireAuth, requireAdmin, async (req, res) => {
    let query = req.body.query.trim();
    let searchQuery = query;
    let barcodeScanned = '';

    try {
        const isBarcode = /^\d{12,13}$/.test(query.replace(/[- ]/g, ''));

        if (isBarcode) {
            barcodeScanned = query.replace(/[- ]/g, '');
            try {
                const upcResponse = await axios.get(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcodeScanned}`);
                if (upcResponse.data.items && upcResponse.data.items.length > 0) {
                    searchQuery = upcResponse.data.items[0].title;
                    searchQuery = searchQuery.replace(/Nintendo|PlayStation|Xbox|PS[2-5]|Switch|Wii U?/gi, '').trim();
                }
            } catch (upcErr) {
                console.error("[ERR] UPC Lookup:", upcErr.message);
            }
        }

        const results = await igdbRequest('games', 
            `search "${searchQuery.replace(/"/g, '\\"')}";
            fields name, cover.url, platforms.name, first_release_date, 
                   involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
                   genres.name, summary;
            limit 24;`
        );

        const formattedResults = results.map(formatIGDBResult);

        res.render('add-game', {
            results: formattedResults,
            scanned_barcode: barcodeScanned,
            user: res.locals.user,
            currentType: 'add-game'
        });

    } catch (err) {
        console.error("[ERR] Game search:", err.message);
        res.render('add-game', { results: [], scanned_barcode: '', error: req.t('errors.api_error'), user: res.locals.user, currentType: 'add-game' });
    }
});

// ─── CONFIRM GAME ────────────────────────────────────────────
router.get('/confirm-game/:igdb_id', requireAuth, requireAdmin, async (req, res) => {
    const igdbId = req.params.igdb_id;

    try {
        const results = await igdbRequest('games',
            `where id = ${igdbId};
            fields name, cover.url, platforms.name, platforms.id, first_release_date,
                   involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
                   genres.name, summary;
            limit 1;`
        );

        if (!results || results.length === 0) {
            return res.status(404).send(req.t('errors.generic_server_error'));
        }

        const gameData = formatIGDBResult(results[0]);

        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        const locations = await Item.distinct('location', { owner: adminId ? adminId._id : null, location: { $ne: "" } });
        const genres = await Item.distinct('genre', { owner: adminId ? adminId._id : null, genre: { $ne: "" }, kind: 'Game' });

        const existingItems = await Item.find({
            owner: adminId ? adminId._id : null,
            in_wishlist: false,
            kind: 'Game',
            $or: [
                { igdb_id: parseInt(gameData.igdb_id) },
                { title: { $regex: new RegExp(`^${escapeRegExp(gameData.title)}$`, 'i') } }
            ]
        }).lean();

        res.render('confirm-game', {
            game: gameData,
            scanned_barcode: req.query.barcode || '',
            user: res.locals.user,
            locations,
            genres,
            currentType: 'games',
            existingItems
        });
    } catch (err) {
        console.error("[ERR] Game detail:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// ─── SAVE GAME ───────────────────────────────────────────────
router.post('/save-game', requireAuth, requireAdmin, async (req, res) => {
    try {
        const {
            mongo_id, title, developer, publisher, platform, year,
            igdb_id, format, region, barcode, barcode_locked,
            cover_image, in_wishlist, comments, location, genre, genres, styles, 
            playStatus, user_rating, quantity
        } = req.body;

        const parsedGenres = Array.isArray(genres) ? genres : (genres ? genres.split(',').map(g => g.trim()).filter(Boolean) : []);
        const parsedStyles = Array.isArray(styles) ? styles : (styles ? styles.split(',').map(s => s.trim()).filter(Boolean) : []);

        const adminId = req.user._id;
        const isWishlist = in_wishlist === 'true';
        let game;
        let isEdit = false;

        if (mongo_id) {
            game = await Item.findOne({ _id: mongo_id, owner: adminId });
            isEdit = true;
        }

        if (!game) {
            game = await findDuplicateGame(
                adminId,
                igdb_id,
                title,
                platform,
                format
            );
        }

        if (game) {
            const qtyToAdd = parseInt(quantity) || 1;
            const finalQty = isEdit ? qtyToAdd : (game.quantity || 1) + qtyToAdd;

            if (isEdit) {
                game.title = title;
                game.developer = developer;
                game.publisher = publisher;
                game.platform = platform;
                game.year = year;
                game.format = format;
                game.region = region || '';
                game.barcode = barcode;
                game.barcode_locked = barcode_locked === 'on';
                game.cover_image = cover_image;
                game.in_wishlist = isWishlist;
                game.comments = comments || '';
                game.location = location || '';
                game.genre = genre || (parsedGenres.length > 0 ? parsedGenres[0] : '');
                game.genres = parsedGenres;
                game.styles = parsedStyles;
                game.playStatus = playStatus || 'to_play';
                game.user_rating = user_rating || 0;
                game.quantity = finalQty;
            } else {
                // Duplicate addition: just increment quantity and preserve existing fields.
                game.quantity = finalQty;
                if (igdb_id && !game.igdb_id) {
                    game.igdb_id = parseInt(igdb_id);
                }
            }

            await game.save();
        } else {
            await Game.create({
                title, developer, publisher, platform, year,
                igdb_id, format, region: region || '', barcode,
                barcode_locked: barcode_locked === 'on',
                cover_image,
                kind: 'Game',
                in_wishlist: isWishlist,
                owner: adminId,
                comments: comments || '',
                location: location || '',
                genre: genre || (parsedGenres.length > 0 ? parsedGenres[0] : ''),
                genres: parsedGenres,
                styles: parsedStyles,
                playStatus: playStatus || 'to_play',
                user_rating: user_rating || 0,
                quantity: quantity || 1,
            });
        }

        if (isWishlist) {
            res.redirect('/wishlist');
        } else {
            res.redirect(`/collection?type=games`);
        }

    } catch (err) {
        console.error("[ERR] Game save:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// ─── EDIT GAME ───────────────────────────────────────────────
router.get('/game/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const game = await Item.findOne({ _id: req.params.id, owner: req.user._id });
        if (!game || game.kind !== 'Game') {
            return res.redirect('/collection?type=games');
        }

        const adminId = await getAdminId();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });
        const genres = await Item.distinct('genre', { owner: adminId, genre: { $ne: "" }, kind: 'Game' });

        res.render('edit-game', { game: game.toObject(), user: res.locals.user, locations, genres, currentType: 'games' });
    } catch (err) {
        console.error(err);
        res.redirect('/collection?type=games');
    }
});

// ─── GAME DETAIL ─────────────────────────────────────────────
router.get('/game/:id', requireAuth, async (req, res) => {
    try {
        const game = await Item.findById(req.params.id);
        if (!game || game.kind !== 'Game') return res.redirect('/collection?type=games');

        res.render('game-detail', { game: game.toObject(), user: res.locals.user, currentType: 'game' });
    } catch (err) {
        res.redirect('/collection?type=games');
    }
});

// ─── DELETE GAME ─────────────────────────────────────────────
router.delete('/api/game/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const game = await Item.findOne({ _id: req.params.id, owner: res.locals.user._id });

        if (!game) {
            return res.status(404).json({ error: "Game not found or you are not the owner." });
        }

        await Item.deleteOne({ _id: req.params.id });
        res.json({ success: true, redirectUrl: `/collection?type=games` });

    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// ─── REFRESH GAME INFO ───────────────────────────────────────
router.post('/api/game/:id/refresh-info', requireAuth, requireAdmin, async (req, res) => {
    try {
        const game = await Game.findById(req.params.id);
        if (!game) return res.status(404).json({ success: false, error: 'Game not found' });

        if (!game.igdb_id) {
            return res.status(400).json({ success: false, error: 'No IGDB ID to refresh' });
        }

        const results = await igdbRequest('games',
            `where id = ${game.igdb_id};
            fields name, cover.url, first_release_date, genres.name, summary,
                   involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
            limit 1;`
        );

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, error: 'Not found on IGDB API' });
        }

        const formatted = formatIGDBResult(results[0]);
        const genres = formatted.genres || [];

        await Game.updateOne(
            { _id: game._id },
            {
                $set: {
                    cover_image: formatted.cover_image,
                    genres: genres,
                    genre: genres[0] || '',
                    year: formatted.year,
                    developer: formatted.developer || game.developer,
                    publisher: formatted.publisher || game.publisher
                }
            }
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
