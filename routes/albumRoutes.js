const express = require('express');
const router = express.Router();
const axios = require('axios');
const Album = require('../models/Album');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware'); // Protect routes
const User = require('../models/User');

// routes/albumRoutes.js
// Dashboard: view collection summary
router.get('/', requireAuth, async (req, res) => {
    try {
        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();

        // Latest collection additions (4 items)
        const latestCollection = await Album.find({ owner: adminId, in_wishlist: false })
            .sort({ added_at: -1 }).limit(4);

        // Latest wishlist additions (4 items)
        const latestWishlist = await Album.find({ owner: adminId, in_wishlist: true })
            .sort({ added_at: -1 }).limit(4);

        // Calculate basic fun stats
        const allCollection = await Album.find({ owner: adminId, in_wishlist: false });
        
        // Total count
        const totalCount = allCollection.length;
        
        // Count vinyl vs CD and cassette
        const cdCount = allCollection.filter(a => a.media_type === 'cd').length;
        const cassetteCount = allCollection.filter(a => a.media_type === 'cassette').length; 
        const vinylCount = totalCount - cdCount - cassetteCount; 

        // Most frequent artist (simple logic)
        const artistMap = {};
        let topArtistName = req.t('common.not_available');
        let topArtistCount = 0;

        allCollection.forEach(album => {
            artistMap[album.artist] = (artistMap[album.artist] || 0) + 1;
            if (artistMap[album.artist] > topArtistCount) {
                topArtistCount = artistMap[album.artist];
                topArtistName = album.artist;
            }
        });

        res.render('index', { 
            latestCollection,
            latestWishlist,
            stats: {
                total: totalCount,
                vinylCount,
                cdCount,
                cassetteCount,
                topArtist: topArtistName,
                topArtistCount
            },
            user: res.locals.user 
        });

    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).send(req.t('errors.generic_server_error'))
    }
});


router.get('/collection', requireAuth, async (req, res) => {
    try {
        const typeFilter = req.query.type;
        const searchQuery = req.query.search; // Retrieve search query
        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();

        let query = { 
            owner: adminId, 
            in_wishlist: false 
        };
        
        // Filter by media type
        if (typeFilter) {
            query.media_type = typeFilter;
        }

        // Search filter (title or artist)
        if (searchQuery) {
            // Use $regex to perform a case-insensitive contains search
            query.$or = [
                { title: { $regex: searchQuery, $options: 'i' } },
                { artist: { $regex: searchQuery, $options: 'i' } },
                { location: { $regex: searchQuery, $options: 'i' } }
            ];
        }

        const albums = await Album.find(query).sort({ added_at: -1 });
        const locations = await Album.distinct('location', { owner: adminId, in_wishlist: false, location: { $ne: "" } });
        
        res.render('collection', { 
            albums,
            locations,
            currentType: typeFilter || 'all',
            searchQuery: searchQuery || '', // Preserve search text for input
            user: res.locals.user 
        });
    } catch (err) {
        console.log(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Add-vinyl search page (view)
router.get('/add-vinyl', requireAuth, requireAdmin, (req, res) => {
    res.render('add-vinyl', { results: null, user: res.locals.user });
});


// route for editing an existing album
router.get('/edit/:id', requireAuth, async (req, res) => {
    try {
        // Find the album by its MongoDB ID (not Discogs ID)
        const album = await Album.findById(req.params.id);
        
        if (!album) {
            return res.redirect('/collection');
        }

        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        const locations = await Album.distinct('location', { owner: adminId, location: { $ne: "" } });
        
        // Render the edit view with the album
        res.render('edit-vinyl', { vinyl: album, user: res.locals.user, locations });
    } catch (err) {
        console.error(err);
        res.redirect('/collection');
    }
});

router.post('/search-discogs', requireAuth, requireAdmin, async (req, res) => {
  const query = req.body.query;
  const type = req.body.type || 'vinyl'; // Default to vinyl if not specified
  const token = process.env.DISCOGS_TOKEN;

    try {
        // Adapt the Discogs API request according to the media type
        // format=vinyl or format=cd or format=cassette
    const url = `https://api.discogs.com/database/search?q=${query}&type=release&format=${type}&token=${token}`;
    
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'DVinylApp/1.0' }
    });

    res.render('add-vinyl', { 
        results: response.data.results.slice(0, 10),
        searchType: type, // Return the type to keep the correct button selected
        user: res.locals.user
    });
  } catch (err) {
    console.log(err);
    res.render('add-vinyl', { results: [], error: req.t('errors.api_error'), searchType: type, user: res.locals.user });
  }
});
// Confirmation with extended info
router.get('/confirm-vinyl/:id', requireAuth, async (req, res) => {
    const discogsId = req.params.id;
    const token = process.env.DISCOGS_TOKEN;

    try {
        const url = `https://api.discogs.com/releases/${discogsId}?token=${token}`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'DVinylApp/1.0' } });
        const data = response.data;

        // Logic to separate format vs. color/variant
        // Define standard terms to distinguish format descriptors from variants
        const standardTerms = ['Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold', '12"', '7"'];
        
        let formatType = [];
        let variantColor = [];

        if (data.formats && data.formats.length > 0) {
            const f = data.formats[0];
            formatType.push(f.name); // e.g. "Vinyl"
            if (f.descriptions) {
                f.descriptions.forEach(desc => {
                    if (standardTerms.includes(desc)) {
                        formatType.push(desc);
                    } else {
                        variantColor.push(desc); // Non-standard term likely a color or special edition
                    }
                });
            }
        }
        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        const locations = await Album.distinct('location', { owner: adminId, location: { $ne: "" } });

        const vinyl = {
            title: data.title,
            artist: data.artists ? data.artists.map(a => a.name).join(', ') : 'Unknown',
            year: data.year || '',
            label: data.labels && data.labels.length > 0 ? data.labels[0].name : '',
            catalog_number: data.labels && data.labels.length > 0 ? data.labels[0].catno : '',
            
            // Separate format and variant info
            format_type: formatType.join(', '),
            variant_color: variantColor.join(', '), // e.g. "Red, Limited Edition"

            tracklist: data.tracklist || [], // Discogs returns a proper array
            cover_image: data.images && data.images.length > 0 ? data.images[0].resource_url : '',
            discogs_id: data.id,
            // location: locations.length > 0 ? locations[0] : '',
        };

        res.render('confirm-vinyl', { vinyl, user: res.locals.user, locations });
    } catch (err) {
        console.log(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    } 
});

// Save handler: smart create or update logic
// Performs creation or update depending on provided IDs
router.post('/save-vinyl', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { 
            mongo_id, // internal MongoDB ID (if editing)
            title, artist, year, label, catalog_number, 
            format_type, variant_color, 
            cover_image, user_image, discogs_id, tracklist_json,
            media_type, in_wishlist, comments, location
        } = req.body;
        
        const tracklist = tracklist_json ? JSON.parse(tracklist_json) : [];
        const userId = res.locals.user._id;
        const isWishlist = in_wishlist === 'true';
        
        let album;

        // Smart matching
        // If a mongo_id is provided (editing), search by that ID first
        if (mongo_id) {
            album = await Album.findOne({ _id: mongo_id, owner: userId });
        }
        
        // If not found by mongo_id, attempt to match by discogs_id (typical add flow)
        if (!album) {
            album = await Album.findOne({ discogs_id: discogs_id, owner: userId });
        }

        if (album) {
            // UPDATE
            // Update fields safely even if Discogs ID changes
            
            album.title = title;
            album.artist = artist;
            album.discogs_id = discogs_id;
            album.year = year;
            album.label = label;
            album.catalog_number = catalog_number;
            album.format_type = format_type;
            album.variant_color = variant_color;
            album.tracklist = tracklist;
            album.cover_image = cover_image;
            album.in_wishlist = isWishlist;
            album.media_type = media_type || 'vinyl';
            album.comments = comments || '';
            album.location = location || '';
            
            if (user_image && user_image.length > 0) {
                album.user_image = user_image;
            }

            await album.save();
            console.log(`Album updated : ${title}`);
        } else {
            // CREATE
            await Album.create({
                title, artist, year, label, catalog_number,
                format_type, variant_color,
                tracklist,
                cover_image, 
                user_image, 
                discogs_id,
                media_type: media_type || 'vinyl',
                in_wishlist: isWishlist,
                owner: userId,
                comments: comments || '',
                location: location || ''
            });
            console.log(`Album créé : ${title}`);
        }

        // Redirect after save
        if (isWishlist) {
            res.redirect('/wishlist');
        } else {
            res.redirect(`/collection?type=${media_type || 'vinyl'}`);
        }

    } catch (err) {
        console.error("Save error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// API route to move an album from wishlist to collection
router.post('/api/album/:id/move-to-collection', requireAuth, requireAdmin, async (req, res) => {
    try {
        await Album.findByIdAndUpdate(req.params.id, { in_wishlist: false, added_at: new Date() });
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// API route to fetch all collection discogs IDs (used for global estimates)
router.get('/api/collection/ids', requireAuth, async (req, res) => {
    try {
        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();

        // Query all collection albums (excluding wishlist)
        // Select only the 'discogs_id' field for performance
        const albums = await Album.find({ 
            owner: adminId, 
            in_wishlist: false 
        }).select('discogs_id');
        
        console.log(`📦 Global estimate: ${albums.length} albums sent to front-end.`);

        // Return JSON
        res.json({ success: true, albums });

    } catch (err) {
        console.error("API Collection IDs error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

router.get('/wishlist', requireAuth, async (req, res) => {
    try {

        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        // Retrieve only wishlist items
        const albums = await Album.find({ 
            owner: adminId,
            in_wishlist: true 
        }).sort({ added_at: -1 });

        res.render('wishlist', { 
            albums, 
            user: res.locals.user 
        });
    } catch (err) {
        console.log(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// collection item detail
router.get('/album/:id', requireAuth, async (req, res) => {
    try {
        const album = await Album.findById(req.params.id);
        if (!album) return res.redirect('/collection');
        
        res.render('vinyl-detail', { album, vinyl: album, user: res.locals.user });
    } catch (err) {
        res.redirect('/collection');
    }
});

// Delete route (API)
router.delete('/api/album/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        // Look up the album to determine its media type (CD or vinyl)
        const album = await Album.findOne({ _id: req.params.id, owner: res.locals.user._id });

        if (!album) {
            return res.status(404).json({ error: "Album not found or you are not the owner." });
        }

        // Save the type for redirect
        const typeRedirect = album.media_type || 'vinyl';

        // Delete
        await Album.deleteOne({ _id: req.params.id });

        // Respond to the frontend with the redirect URL
        res.json({ success: true, redirectUrl: `/collection?type=${typeRedirect}` });

    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Internal API to search Google Images
router.get('/api/google-images', requireAuth, async (req, res) => {
    const query = req.query.q;
    const apiKey = process.env.GOOGLE_API_KEY; // Google Custom Search API key
    const cx = process.env.GOOGLE_CSE_ID; // Custom Search Engine ID

    if (!query) return res.status(400).json([]);

    try {
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&cx=${cx}&searchType=image&key=${apiKey}&num=8`;
        const response = await axios.get(url);
        
        // Return only the image links
        const images = response.data.items.map(item => item.link);
        res.json(images);
    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Estimate route (Discogs API)
router.get('/api/estimate/:discogsId', requireAuth, async (req, res) => {
    try {
        const discogsId = req.params.discogsId;
        const token = process.env.DISCOGS_TOKEN;

        // PLAN A: Active marketplace prices
        try {
            const statsRes = await fetch(`https://api.discogs.com/marketplace/stats/${discogsId}?curr_abbr=EUR&token=${token}`, {
                headers: { 'User-Agent': 'DVinylApp/1.0' }
            });

            if (statsRes.ok) {
                const statsData = await statsRes.json();
                
                // Verify there's a non-zero lowest price
                if (statsData.lowest_price && statsData.lowest_price.value > 0) {
                    console.log(`💰 Plan A (market) for ID ${discogsId}: ${statsData.lowest_price.value}€`);
                    return res.json({
                        success: true,
                        source: 'market', // concrete market data
                        price: statsData.lowest_price,
                        details: `${statsData.num_for_sale} for sale`
                    });
                }
            }
        } catch (e) {
            console.log(`⚠️ Plan A failed for ${discogsId} (not for sale or error)`);
        }

        // PLAN B: Price suggestions / historical fallback
        // If we reach here, Plan A failed (no active sellers or error)
        try {
            const suggRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${discogsId}?token=${token}`, {
                headers: { 'User-Agent': 'DVinylApp/1.0' }
            });

            if (suggRes.ok) {
                const suggData = await suggRes.json();
                
                // Try to find "Very Good Plus" key flexibly (case/format tolerant)
                const keys = Object.keys(suggData);
                const vgKey = keys.find(k => k.toLowerCase().includes('very good plus'));
                const mintKey = keys.find(k => k.toLowerCase().includes('mint (m)')); // Fallback if VG+ doesn't exist

                const bestPrice = suggData[vgKey] || suggData[mintKey];

                if (bestPrice && bestPrice.value > 0) {
                    console.log(`📉 Plan B (history) for ID ${discogsId}: ${bestPrice.value}€`);
                    return res.json({
                        success: true,
                        source: 'history', // historical estimation
                        price: bestPrice,
                        details: "Based on historical data (VG+)"
                    });
                }
            }
            } catch (e) {
            console.log(`⚠️ Plan B failed for ${discogsId}`);
        }

        // TOTAL FAILURE
        console.log(`❌ No price found for ${discogsId}`);
        res.json({ success: false, error: "Unavailable" });

    } catch (err) {
        console.error("Estimation server error:", err);
        res.json({ success: false, error: "Server error" });
    }
});

module.exports = router;