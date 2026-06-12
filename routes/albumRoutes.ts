import express from 'express';
import Vinyl from '../models/Vinyl';
import Item from '../models/Item';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import User from '../models/User';
import { STANDARD_FORMAT_TERMS } from '../config/constants';
import { applyVisibilityFilter } from '../utils/visibilityHelper';
import Settings from '../models/Settings';

const fetchJson = async (url: string, options?: RequestInit): Promise<any> => {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
};

const router = express.Router();

async function getAdminId(): Promise<any> {
    const admin = await User.findOne({ isAdmin: true }).select('_id');
    return admin ? admin._id : null;
}

const formatForView = (item: any): any => {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;

    return {
        ...obj,
        artist: obj.artist || obj.creator || obj.author || obj.director || 'Inconnu',
        media_type: obj.media_type || obj.format || 'other',
        cover_image: obj.cover_image || obj.coverUrl || '/ressources/logo.png',
        tracklist: obj.tracklist || [],
        label: obj.label || obj.publisher || obj.studio || '',
        year: obj.year || '',
        format_type: obj.format_type || '',
        variant_color: obj.variant_color || '',
        sleeve_condition: obj.sleeve_condition || '',
        location: obj.location || '',
        genre: obj.genre || '',
        quantity: obj.quantity || 1,
        country: obj.country || ''
    };
};

// Dashboard: view collection summary
router.get('/', requireAuth, async (req: any, res: any) => {
    try {
        const adminId = await getAdminId();
        const settings = res.locals.settings;
        let queryAll: any = { owner: adminId, in_wishlist: false };
        applyVisibilityFilter(queryAll, res.locals.isAdmin, settings);
        const allItems = await Item.find(queryAll).lean() as any[];

        const countByFormat = (items: any[], format: string) => {
            return items
                .filter(i => {
                    const f = (i.media_type || i.format || '').toLowerCase();
                    return f === format.toLowerCase();
                })
                .reduce((acc, i) => acc + Number(i.quantity || 1), 0);
        };

        const stats: any = {
            total: allItems.reduce((acc, i) => acc + (i.quantity || 1), 0),

            vinyl: countByFormat(allItems, 'vinyl'),
            cd: countByFormat(allItems, 'cd'),
            cassette: countByFormat(allItems, 'cassette'),

            book_total: allItems.filter(i => i.kind === 'Book').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_hardcover: allItems.filter(i => i.kind === 'Book' && i.format === 'hardcover').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_paperback: allItems.filter(i => i.kind === 'Book' && i.format === 'paperback').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_manga: allItems.filter(i => i.kind === 'Book' && i.format === 'manga').reduce((acc, i) => acc + (i.quantity || 1), 0),
            book_comic: allItems.filter(i => i.kind === 'Book' && i.format === 'comic').reduce((acc, i) => acc + (i.quantity || 1), 0),

            dvd_total: allItems.filter(i => i.kind === 'Dvd').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_dvd: allItems.filter(i => i.kind === 'Dvd' && i.format === 'dvd').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_bluray: allItems.filter(i => i.kind === 'Dvd' && i.format === 'bluray').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_4k: allItems.filter(i => i.kind === 'Dvd' && i.format === '4k').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_vhs: allItems.filter(i => i.kind === 'Dvd' && i.format === 'vhs').reduce((acc, i) => acc + (i.quantity || 1), 0),
            dvd_laserdisc: allItems.filter(i => i.kind === 'Dvd' && i.format === 'laserdisc').reduce((acc, i) => acc + (i.quantity || 1), 0),

            game_total: allItems.filter(i => i.kind === 'Game').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_physical: allItems.filter(i => i.kind === 'Game' && i.format === 'physical').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_collector: allItems.filter(i => i.kind === 'Game' && i.format === 'collector').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_limited: allItems.filter(i => i.kind === 'Game' && i.format === 'limited').reduce((acc, i) => acc + (i.quantity || 1), 0),
            game_steelbook: allItems.filter(i => i.kind === 'Game' && i.format === 'steelbook').reduce((acc, i) => acc + (i.quantity || 1), 0)
        };

        const getTop = (items: any[], field: string) => {
            const map: Record<string, number> = {};
            let topName = req.t('common.not_available');
            let topCount = 0;
            items.forEach(item => {
                const name = item[field];
                if (name) {
                    map[name] = (map[name] || 0) + 1;
                    if (map[name] > topCount) {
                        topCount = map[name];
                        topName = name;
                    }
                }
            });
            return { name: topName, count: topCount };
        };

        stats.artist = getTop(allItems.filter(i => i.kind === 'Music' || (!i.kind && i.artist)), 'artist');
        stats.music_genre = getTop(allItems.filter(i => i.kind === 'Music' || !i.kind), 'genre');
        stats.label = getTop(allItems.filter(i => i.kind === 'Music' || !i.kind), 'label');

        stats.author = getTop(allItems.filter(i => i.kind === 'Book'), 'author');
        stats.publisher = getTop(allItems.filter(i => i.kind === 'Book'), 'publisher');

        stats.director = getTop(allItems.filter(i => i.kind === 'Dvd'), 'director');
        stats.studio = getTop(allItems.filter(i => i.kind === 'Dvd'), 'studio');

        stats.game_developer = getTop(allItems.filter(i => i.kind === 'Game'), 'developer');
        stats.game_publisher = getTop(allItems.filter(i => i.kind === 'Game'), 'publisher');

        let latestQuery: any = { owner: adminId, in_wishlist: false };
        applyVisibilityFilter(latestQuery, res.locals.isAdmin, settings);

        let wishlistQuery: any = { owner: adminId, in_wishlist: true };
        applyVisibilityFilter(wishlistQuery, res.locals.isAdmin, settings);

        res.render('index', {
            latestCollection: (await Item.find(latestQuery).sort({ added_at: -1 }).limit(4)).map(formatForView),
            latestWishlist: (await Item.find(wishlistQuery).sort({ added_at: -1 }).limit(4)).map(formatForView),
            stats,
            settings
        });
    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

router.get('/collection', requireAuth, async (req: any, res: any) => {
    try {
        const adminId = await getAdminId();
        const { search, type, format, location, genre, style, artist, decade } = req.query as Record<string, string | undefined>;
        let sort = req.query.sort as string | undefined;
        if (sort) {
            res.cookie('sortPref', sort, { maxAge: 365 * 24 * 60 * 60 * 1000 });
        } else {
            sort = (req.cookies.sortPref as string) || 'added_desc';
        }
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 25;

        let query: any = { owner: adminId, in_wishlist: false };
        let conditions: any[] = [];

        if (search) {
            const regex = new RegExp(escapeRegExp(search), 'i');
            conditions.push({
                $or: [{ title: regex }, { artist: regex }, { author: regex }, { director: regex }, { barcode: regex }]
            });
        }

        if (type && type !== 'all') {
            const typeMap: Record<string, string> = { music: 'Music', books: 'Book', dvd: 'Dvd', games: 'Game' };
            if (type === 'music') {
                conditions.push({
                    $or: [{ kind: 'Music' }, { kind: { $exists: false } }]
                });
            } else {
                query.kind = typeMap[type];
            }
        }

        if (format && format !== 'all') {
            const formatRegex = new RegExp(`^${escapeRegExp(format)}$`, 'i');
            conditions.push({
                $or: [{ media_type: formatRegex }, { format: formatRegex }]
            });
        }

        if (location) {
            conditions.push({ location: new RegExp(escapeRegExp(location), 'i') });
        }

        if (artist) {
            const artistRegex = new RegExp(escapeRegExp(artist), 'i');
            conditions.push({
                $or: [
                    { artist: artistRegex },
                    { artists: artistRegex },
                    { author: artistRegex },
                    { director: artistRegex },
                    { developer: artistRegex },
                    { label: artistRegex }
                ]
            });
        }

        if (genre) {
            const genreArr = genre.split(',').map(g => g.trim()).filter(Boolean);
            if (genreArr.length > 0) {
                conditions.push({
                    $or: [
                        { genre: { $in: genreArr.map(g => new RegExp(escapeRegExp(g), 'i')) } },
                        { genres: { $in: genreArr.map(g => new RegExp(escapeRegExp(g), 'i')) } }
                    ]
                });
            }
        }

        if (style) {
            const styleArr = style.split(',').map(s => s.trim()).filter(Boolean);
            if (styleArr.length > 0) {
                conditions.push({
                    styles: { $in: styleArr.map(s => new RegExp(escapeRegExp(s), 'i')) }
                });
            }
        }

        if (decade) {
            const decadeArr = decade.split(',').map(d => parseInt(d)).filter(d => !isNaN(d));
            if (decadeArr.length > 0) {
                const years: RegExp[] = [];
                decadeArr.forEach(startYear => {
                    for (let y = startYear; y < startYear + 10; y++) {
                        years.push(new RegExp(`^${y}$`));
                    }
                });
                conditions.push({ year: { $in: years } });
            }
        }

        const filterMode = (req.query.filterMode as string) || 'show';
        if (filterMode === 'hide' && conditions.length > 0) {
            query.$and = [{ $nor: [{ $and: conditions }] }];
        } else if (conditions.length > 0) {
            query.$and = conditions;
        }

        applyVisibilityFilter(query, res.locals.isAdmin, res.locals.settings);

        const totalItems = await Item.countDocuments(query);

        const buildSortObj = () => {
            const sortMap: Record<string, any> = {
                'added_desc': { added_at: -1 },
                'added_asc': { added_at: 1 },
                'title_asc': { title: 1 },
                'title_desc': { title: -1 },
                'year_desc': { year: -1 },
                'year_asc': { year: 1 },
            };

            if (sort && sort.startsWith('artist')) {
                const dir = sort === 'artist_asc' ? 1 : -1;
                if (!type || type === 'all') return { title: dir };
                const artistFieldMap: Record<string, string> = { music: 'artist', books: 'author', dvd: 'director', games: 'developer' };
                const field = artistFieldMap[type] || 'title';
                return { [field]: dir };
            }

            return sortMap[sort || ''] || { added_at: -1 };
        };

        const albums = await Item.find(query)
            .sort(buildSortObj())
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const filterMap: Record<string, { id: string; label: string }[]> = {
            music: [
                { id: 'vinyl', label: req.t('media.vinyl') },
                { id: 'cd', label: req.t('media.cd') },
                { id: 'cassette', label: req.t('media.cassette') }
            ],
            books: [
                { id: 'manga', label: req.t('media.manga') },
                { id: 'comic', label: req.t('media.comic') },
                { id: 'hardcover', label: req.t('media.hardcover') },
                { id: 'paperback', label: req.t('media.paperback') }
            ],
            dvd: [
                { id: 'dvd', label: req.t('media.dvd') },
                { id: 'bluray', label: req.t('media.bluray') },
                { id: '4k', label: req.t('media.4k') }
            ],
            games: [
                { id: 'physical', label: req.t('media.physical') },
                { id: 'collector', label: req.t('media.collector') },
                { id: 'limited', label: req.t('media.limited') },
                { id: 'steelbook', label: req.t('media.steelbook') }
            ]
        };

        const artistList = await (async () => {
            const baseQuery: any = { owner: adminId, in_wishlist: false };
            if (!type || type === 'all') {
                const [artists, authors, directors, developers] = await Promise.all([
                    Item.distinct('artist', { ...baseQuery, artist: { $nin: ['', null] } }),
                    Item.distinct('author', { ...baseQuery, author: { $nin: ['', null] } }),
                    Item.distinct('director', { ...baseQuery, director: { $nin: ['', null] } }),
                    Item.distinct('developer', { ...baseQuery, developer: { $nin: ['', null] } })
                ]);
                return [...new Set([...artists, ...authors, ...directors, ...developers])].filter(Boolean).sort();
            }
            const fieldMap: Record<string, string> = { music: 'artist', books: 'author', dvd: 'director', games: 'developer' };
            const field = fieldMap[type];
            if (!field) return [];
            const typeMap: Record<string, string> = { music: 'Music', books: 'Book', dvd: 'Dvd', games: 'Game' };
            const typeQuery = type === 'music'
                ? { ...baseQuery, $or: [{ kind: 'Music' }, { kind: { $exists: false } }] }
                : { ...baseQuery, kind: typeMap[type] };
            return (await Item.distinct(field, { ...typeQuery, [field]: { $nin: ['', null] } })).sort();
        })();

        res.render('collection', {
            albums: albums.map(formatForView),
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            queryLimit: limit,
            currentType: type || 'all',
            currentFormat: format || 'all',
            querySearch: search || '',
            queryLocation: location || '',
            queryGenre: genre || '',
            queryStyle: style || '',
            queryArtist: artist || '',
            queryDecade: decade || '',
            queryFilterMode: filterMode,
            currentSort: sort,

            activeFilters: filterMap[type || ''] || [],
            artistList,
            locations: await Item.distinct('location', { owner: adminId }),
            genres: await (async () => {
                if (!type || type === 'all') return [];
                const typeMap: Record<string, string> = { music: 'Music', books: 'Book', dvd: 'Dvd', games: 'Game' };
                const kind = typeMap[type];
                const typeQuery = type === 'music' ? { $or: [{ kind: 'Music' }, { kind: { $exists: false } }] } : { kind };

                const [gBase, gArray] = await Promise.all([
                    Item.distinct('genre', { owner: adminId, ...typeQuery, genre: { $nin: ['', null] } }),
                    Item.distinct('genres', { owner: adminId, ...typeQuery })
                ]);
                return [...new Set([...gBase, ...gArray])].filter(Boolean).sort();
            })(),
            styles: await (async () => {
                if (type !== 'music') return [];
                const sArray = await Item.distinct('styles', {
                    owner: adminId,
                    $or: [{ kind: 'Music' }, { kind: { $exists: false } }]
                });
                return [...new Set(sArray)].filter(Boolean).sort();
            })(),
            standardFormatTerms: STANDARD_FORMAT_TERMS,
        });

    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Add-vinyl search page (view)
router.get('/add-vinyl', requireAuth, requireAdmin, (req: any, res: any) => {
    const validTypes = ['vinyl', 'cd', 'cassette'];
    const searchType = validTypes.includes(req.query.type as string) ? (req.query.type as string) : 'vinyl';
    const searchQuery = (req.query.search as string) || '';
    res.render('add-vinyl', { searchType, searchQuery, currentType: 'add-vinyl' });
});

// route for editing an existing album
router.get('/album/edit/:id', requireAuth, async (req: any, res: any) => {
    try {
        const album = await Item.findById(req.params.id);
        if (!album) {
            return res.redirect('/collection?type=music');
        }
        const albumFormatted = formatForView(album);
        const adminId = await getAdminId();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });
        const genres = await Item.distinct('genre', {
            owner: adminId,
            genre: { $ne: "" },
            $or: [{ kind: 'Music' }, { kind: { $exists: false } }]
        });

        res.render('edit-vinyl', { vinyl: albumFormatted, user: res.locals.user, locations, genres, currentType: 'music' });
    } catch (err) {
        console.error(err);
        res.redirect('/collection?type=music');
    }
});

router.post('/search-discogs', requireAuth, requireAdmin, async (req: any, res: any) => {
    const query = (req.body.query as string) || '';
    const type = (req.body.type as string) || 'vinyl';

    // Advanced filters
    const year = req.body.year;
    const country = req.body.country;
    const genre_filter = req.body.genre_filter;
    const label_filter = req.body.label_filter;

    const token = process.env.DISCOGS_TOKEN;

    try {
        const settings = await Settings.findOne({});
        const enableAdvancedCD = settings && settings.modules && settings.modules.advancedCD;

        let searchUrls: string[] = [];
        let isDirectRelease = false;

        const urlMatch = query.match(/discogs\.com\/(?:[a-zA-Z]{2}\/)?(release|master)\/(\d+)/);

        if (urlMatch) {
            const itemType = urlMatch[1];
            const itemId = urlMatch[2];

            if (itemType === 'master') {
                searchUrls.push(`https://api.discogs.com/database/search?master_id=${itemId}&type=release&token=${token}`);
            } else if (itemType === 'release') {
                searchUrls.push(`https://api.discogs.com/releases/${itemId}?token=${token}`);
                isDirectRelease = true;
            }
        } else {
            let advancedParams = '';
            if (year) advancedParams += `&year=${encodeURIComponent(year)}`;
            if (country) advancedParams += `&country=${encodeURIComponent(country)}`;
            if (genre_filter) advancedParams += `&genre=${encodeURIComponent(genre_filter)}`;
            if (label_filter) advancedParams += `&label=${encodeURIComponent(label_filter)}`;

            if (type === 'cd' && enableAdvancedCD) {
                searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=CD${advancedParams}&token=${token}`);
                searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=SACD${advancedParams}&token=${token}`);
                searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=CDr${advancedParams}&token=${token}`);
            } else {
                searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=${type}${advancedParams}&token=${token}`);
            }
        }

        const responses = await Promise.all(searchUrls.map(url => fetchJson(url, { headers: { 'User-Agent': 'DVinylApp/1.0' } })));

        let allResults: any[] = [];
        if (isDirectRelease) {
            const r = responses[0]!;
            const mappedResult = {
                id: r.id,
                title: r.artists ? r.artists.map((a: any) => a.name).join(', ') + ' - ' + r.title : r.title,
                year: r.year,
                country: r.country,
                cover_image: (r.images && r.images.length > 0) ? r.images[0].resource_url : r.thumb,
                formats: r.formats,
                format: r.formats && r.formats[0] ? [r.formats[0].name, ...(r.formats[0].descriptions || [])] : []
            };
            allResults.push(mappedResult);
        } else {
            responses.forEach((response, index) => {
                let results = response.results || [];
                if (!urlMatch && type === 'cd' && enableAdvancedCD) {
                    if (index === 1) results = results.map((item: any) => ({ ...item, is_advanced_cd: 'sacd' }));
                    else if (index === 2) results = results.map((item: any) => ({ ...item, is_advanced_cd: 'cdr' }));
                }
                allResults = allResults.concat(results);
            });
        }

        const technicalBlacklist = [
            'Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold',
            '12"', '7"', 'Limited Edition', 'Compilation', 'Deluxe Edition', 'Numbered', 'Promo'
        ];

        const uniqueIds = new Set();
        const deduplicatedResults: any[] = [];
        for (const item of allResults) {
            if (!uniqueIds.has(item.id)) {
                uniqueIds.add(item.id);
                deduplicatedResults.push(item);
            }
        }

        const processedResults = deduplicatedResults.slice(0, 100).map(item => {
            let variant_info = '';

            if (item.formats && item.formats[0] && item.formats[0].text) {
                variant_info = item.formats[0].text.split(',')
                    .map((p: string) => p.trim())
                    .filter((part: string) => !technicalBlacklist.some(term => part.toLowerCase().includes(term.toLowerCase())))
                    .join(', ');
            }

            return {
                ...item,
                variant_info: variant_info,
                country: item.country || ''
            };
        });

        res.render('add-vinyl', {
            results: processedResults,
            searchType: type,
            user: res.locals.user,
            currentType: 'add-vinyl'
        });
    } catch (err: any) {
        console.error(`❌ Discogs Search error:`, err.message);
        res.render('add-vinyl', { results: [], error: req.t('errors.api_error'), searchType: type, user: res.locals.user, currentType: 'add-vinyl' });
    }
});

// Confirmation with extended info
router.get('/confirm-vinyl/:id', requireAuth, async (req: any, res: any) => {
    const discogsId = req.params.id;
    const searchTypeHint = req.query.type as string | undefined; // 'vinyl', 'cd', or 'cassette'
    const token = process.env.DISCOGS_TOKEN;

    try {
        const url = `https://api.discogs.com/releases/${discogsId}?token=${token}`;
        const data = await fetchJson(url, { headers: { 'User-Agent': 'DVinylApp/1.0' } });

        let formatType: string[] = [];
        let variantColor: string[] = [];
        let finalMediaType = 'vinyl';

        if (data.formats && data.formats.length > 0) {
            // Find the best matching format if we have a search hint
            let bestFormat = data.formats[0];
            if (searchTypeHint) {
                const hint = searchTypeHint.toLowerCase();
                const matched = data.formats.find((f: any) => f.name.toLowerCase().includes(hint));
                if (matched) bestFormat = matched;
            }

            formatType.push(bestFormat.name);

            if (bestFormat.text) {
                const parts = bestFormat.text.split(',').map((p: string) => p.trim());
                parts.forEach((part: string) => {
                    if (STANDARD_FORMAT_TERMS.includes(part)) {
                        if (!formatType.includes(part)) formatType.push(part);
                    } else {
                        if (!variantColor.includes(part)) variantColor.push(part);
                    }
                });
            }

            if (bestFormat.descriptions) {
                bestFormat.descriptions.forEach((desc: string) => {
                    if (STANDARD_FORMAT_TERMS.includes(desc)) {
                        if (!formatType.includes(desc)) formatType.push(desc);
                    } else {
                        if (!variantColor.includes(desc)) {
                            variantColor.push(desc);
                        }
                    }
                });
            }

            // Determine finalMediaType
            const rawFormat = bestFormat.name.toLowerCase();
            if (rawFormat.includes('cassette')) { finalMediaType = 'cassette'; }
            else if (rawFormat.includes('cd')) { finalMediaType = 'cd'; }
            else { finalMediaType = 'vinyl'; }
        }

        // Overwrite finalMediaType with searchTypeHint if it exists and logic above didn't catch it
        if (searchTypeHint) finalMediaType = searchTypeHint;

        const adminId = await User.findOne({ isAdmin: true }).select('_id').lean();
        const locations = await Item.distinct('location', { owner: adminId, location: { $ne: "" } });
        const genres = await Item.distinct('genre', {
            owner: adminId,
            genre: { $ne: "" },
            $or: [{ kind: 'Music' }, { kind: { $exists: false } }]
        });

        let barcode = '';
        if (data.identifiers && data.identifiers.length > 0) {
            const barcodeObj = data.identifiers.find((id: any) => id.type === 'Barcode');
            if (barcodeObj) {
                barcode = barcodeObj.value.replace(/\s/g, '');
            }
        }

        const vinyl = {
            title: data.title,
            artist: data.artists ? data.artists.map((a: any) => a.name).join(', ') : 'Unknown',
            year: data.year || '',
            label: data.labels && data.labels.length > 0 ? data.labels[0].name : '',
            catalog_number: data.labels && data.labels.length > 0 ? data.labels[0].catno : '',
            format_type: formatType.join(', '),
            variant_color: variantColor.join(', '),
            tracklist: data.tracklist || [],
            cover_image: data.images && data.images.length > 0 ? data.images[0].resource_url : '',
            discogs_id: data.id,
            country: data.country || '',
            genres: data.genres || [],
            styles: data.styles || [],
            barcode: barcode,
            media_type: finalMediaType // Pass it to the view
        };

        res.render('confirm-vinyl', { vinyl, user: res.locals.user, locations, genres, currentType: 'music' });
    } catch (err: any) {
        console.error(`❌ Discogs Release details error for ID ${discogsId}:`, err.message);
        res.render('add-vinyl', {
            results: [],
            error: `${req.t('errors.api_error')} (Discogs HTTP ${err.response ? err.response.status : '500'})`,
            searchType: searchTypeHint || 'vinyl',
            user: res.locals.user,
            currentType: 'add-vinyl'
        });
    }
});

// Save handler: smart create or update logic
router.post('/save-vinyl', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
        const {
            mongo_id, title, artist, year, label, catalog_number, country,
            format_type, variant_color, cover_image, user_image, discogs_id, tracklist_json,
            media_type, in_wishlist, comments, location, genre, quantity,
            genres, styles, barcode, barcode_locked, added_at, sleeve_condition
        } = req.body;

        const parsedGenres = Array.isArray(genres) ? genres : (genres ? genres.split(',').map((g: string) => g.trim()).filter(Boolean) : []);
        const parsedStyles = Array.isArray(styles) ? styles : (styles ? styles.split(',').map((s: string) => s.trim()).filter(Boolean) : []);

        const adminId = req.user._id;
        const isWishlist = in_wishlist === 'true';
        const isBarcodeLocked = barcode_locked === 'on' || barcode_locked === 'true' || barcode_locked === true;

        let album: any = null;

        if (mongo_id) {
            album = await Item.findById(mongo_id);
        }

        if (!album && discogs_id) {
            album = await Item.findOne({ discogs_id: discogs_id, owner: adminId });
        }

        let tracklist: any[] = [];
        if (tracklist_json) {
            tracklist = JSON.parse(tracklist_json);
        } else if (album && album.tracklist) {
            tracklist = album.tracklist;
        }

        if (album) {
            const updateData: any = {
                title: title,
                artist: artist || album.artist,
                discogs_id: discogs_id,
                year: year,
                label: label,
                catalog_number: catalog_number,
                format_type: format_type,
                variant_color: variant_color,
                sleeve_condition: sleeve_condition || '',
                tracklist: tracklist,
                cover_image: cover_image,
                user_image: user_image,
                in_wishlist: isWishlist,
                media_type: media_type || 'vinyl',
                comments: comments || '',
                location: location || '',
                genre: genre || (parsedGenres.length > 0 ? parsedGenres[0] : ''),
                genres: parsedGenres,
                styles: parsedStyles,
                quantity: parseInt(quantity) || 1,
                country: country || '',
                barcode: barcode || '',
                barcode_locked: isBarcodeLocked,
                added_at: added_at ? new Date(added_at) : (album.added_at || new Date()),
                kind: 'Music'
            };

            if (user_image && user_image.length > 0) {
                album.user_image = user_image;
            }

            await Item.updateOne(
                { _id: album._id },
                { $set: updateData },
                { strict: false }
            );
        } else {
            await Vinyl.create({
                title, artist, year, label, catalog_number,
                format_type, variant_color, sleeve_condition: sleeve_condition || '',
                tracklist,
                cover_image,
                user_image,
                discogs_id,
                media_type: media_type || 'vinyl',
                in_wishlist: isWishlist,
                owner: adminId,
                comments: comments || '',
                location: location || '',
                genre: genre || (parsedGenres.length > 0 ? parsedGenres[0] : ''),
                genres: parsedGenres,
                styles: parsedStyles,
                quantity: parseInt(quantity) || 1,
                country: country || '',
                barcode: barcode || '',
                barcode_locked: isBarcodeLocked,
                added_at: added_at ? new Date(added_at) : new Date()
            });
        }

        if (isWishlist) {
            res.redirect('/wishlist');
        } else {
            res.redirect(`/collection?type=music`);
        }

    } catch (err) {
        console.error("Save error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// API route to move an album from wishlist to collection
router.post('/api/album/:id/move-to-collection', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
        await Item.findByIdAndUpdate(req.params.id, { in_wishlist: false, added_at: new Date() });
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// API route to fetch all collection discogs IDs (used for global estimates)
router.get('/api/collection/ids', requireAuth, async (req: any, res: any) => {
    try {
        const adminId = await getAdminId();
        const albums = await Item.find({
            owner: adminId,
            in_wishlist: false,
            $or: [{ kind: 'Music' }, { kind: { $exists: false } }]
        }).select('discogs_id quantity').lean();

        console.log(`📦 Global estimate: ${albums.length} albums sent to front-end.`);
        res.json({ success: true, albums });

    } catch (err) {
        console.error("API Collection IDs error:", err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

router.get('/wishlist', requireAuth, async (req: any, res: any) => {
    try {
        const adminId = await getAdminId();
        let query: any = {
            owner: adminId,
            in_wishlist: true
        };
        applyVisibilityFilter(query, res.locals.isAdmin, res.locals.settings);

        const items = await Item.find(query).sort({ added_at: -1 });

        res.render('wishlist', {
            albums: items.map(formatForView),
            user: res.locals.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// collection item detail
router.get('/album/:id', requireAuth, async (req: any, res: any) => {
    try {
        const album = await Item.findById(req.params.id);
        if (!album) return res.redirect('/collection?type=music');
        const albumFormatted = formatForView(album);

        res.render('vinyl-detail', { album: albumFormatted, vinyl: albumFormatted, user: res.locals.user, currentType: 'album' });
    } catch (err) {
        res.redirect('/collection?type=music');
    }
});

// Delete route (API)
router.delete('/api/album/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
        // Look up the album to determine its owner
        const album = await Item.findOne({ _id: req.params.id, owner: res.locals.user._id });

        if (!album) {
            return res.status(404).json({ error: "Album not found or you are not the owner." });
        }

        // Delete
        await Item.deleteOne({ _id: req.params.id });

        // Respond to the frontend with the redirect URL
        res.json({ success: true, redirectUrl: `/collection?type=music` });

    } catch (err) {
        console.error(err);
        res.status(500).send(req.t('errors.generic_server_error'));
    }
});

// Estimate route (Discogs API)
router.get('/api/estimate/:discogsId', requireAuth, async (req: any, res: any) => {
    try {
        const discogsId = req.params.discogsId;
        const token = process.env.DISCOGS_TOKEN;

        const userCurrency = res.locals.user.currency || 'USD';

        // PLAN A: Active marketplace prices
        try {
            const statsRes = await fetch(`https://api.discogs.com/marketplace/stats/${discogsId}?curr_abbr=${userCurrency}&token=${token}`, {
                headers: { 'User-Agent': 'DVinylApp/1.0' }
            });

            if (statsRes.ok) {
                const statsData = await statsRes.json() as any;

                // Verify there's a non-zero lowest price
                if (statsData.lowest_price && statsData.lowest_price.value > 0) {
                    return res.json({
                        success: true,
                        source: 'market', // concrete market data
                        price: statsData.lowest_price,
                        details: `${statsData.num_for_sale} for sale`
                    });
                }
            }
        } catch (e) {
            // ignore
        }

        // PLAN B: Price suggestions / historical fallback
        try {
            const suggRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${discogsId}?token=${token}`, {
                headers: { 'User-Agent': 'DVinylApp/1.0' }
            });

            if (suggRes.ok) {
                const suggData = await suggRes.json() as any;
                const keys = Object.keys(suggData);

                const condition = ((req.query.condition as string) || '').toUpperCase();
                let targetKey = '';

                if (condition && condition !== 'GENERIC') {
                    if (condition === 'M') {
                        targetKey = keys.find(k => k.toLowerCase().includes('mint (m)')) || '';
                    } else if (condition === 'NM') {
                        targetKey = keys.find(k => k.toLowerCase().includes('near mint')) || '';
                    } else if (condition === 'VG+') {
                        targetKey = keys.find(k => k.toLowerCase().includes('very good plus')) || '';
                    } else if (condition === 'VG') {
                        targetKey = keys.find(k => k.toLowerCase().includes('very good (vg)')) || '';
                    } else if (condition === 'G+') {
                        targetKey = keys.find(k => k.toLowerCase().includes('good plus')) || '';
                    } else if (condition === 'G') {
                        targetKey = keys.find(k => k.toLowerCase().includes('good (g)')) || '';
                    } else if (condition === 'F') {
                        targetKey = keys.find(k => k.toLowerCase().includes('fair (f)')) || '';
                    } else if (condition === 'P') {
                        targetKey = keys.find(k => k.toLowerCase().includes('poor (p)')) || '';
                    }
                }

                if (!targetKey) {
                    const vgKey = keys.find(k => k.toLowerCase().includes('very good plus'));
                    const mintKey = keys.find(k => k.toLowerCase().includes('mint (m)'));
                    targetKey = vgKey || mintKey || keys[0] || '';
                }

                const bestPrice = targetKey ? suggData[targetKey] : null;

                if (bestPrice && bestPrice.value > 0) {
                    let gradeLabel = 'VG+';
                    if (targetKey.toLowerCase().includes('near mint')) gradeLabel = 'NM';
                    else if (targetKey.toLowerCase().includes('mint (m)')) gradeLabel = 'M';
                    else if (targetKey.toLowerCase().includes('very good (vg)')) gradeLabel = 'VG';
                    else if (targetKey.toLowerCase().includes('good plus')) gradeLabel = 'G+';
                    else if (targetKey.toLowerCase().includes('good (g)')) gradeLabel = 'G';
                    else if (targetKey.toLowerCase().includes('fair (f)')) gradeLabel = 'F';
                    else if (targetKey.toLowerCase().includes('poor (p)')) gradeLabel = 'P';

                    return res.json({
                        success: true,
                        source: 'history', // historical estimation
                        price: bestPrice,
                        details: `Based on historical data (${gradeLabel})`
                    });
                }
            }
        } catch (e) {
            // ignore
        }

        // TOTAL FAILURE
        res.json({ success: false, error: "Unavailable" });

    } catch (err) {
        console.error("Estimation server error:", err);
        res.json({ success: false, error: "Server error" });
    }
});

// Discogs import route (starts the import process)
router.post('/import/discogs', requireAuth, async (req: any, res: any) => {
    const { discogsUrl, full, type } = req.body;
    const userId = req.user._id;
    const token = process.env.DISCOGS_TOKEN;

    const usernameMatch = (discogsUrl as string).match(/(?:user\/|user=)([^/?&]+)/);
    if (!usernameMatch) return res.status(400).json({ error: "Invalid Discogs URL" });
    const username = usernameMatch[1];

    await User.findByIdAndUpdate(userId, { discogsUsername: username });

    res.status(202).json({ success: true, message: "Import started" });

    try {
        let page = 1;
        let totalImported = 0;
        let totalProcessed = 0;
        let hasMore = true;

        const isWishlist = (type === 'wishlist');
        const apiUrl = isWishlist ? `https://api.discogs.com/users/${username}/wants` : `https://api.discogs.com/users/${username}/collection/folders/0/releases`;
        const listKey = isWishlist ? 'wants' : 'releases';

        while (hasMore) {
            const params = new URLSearchParams({ page: page.toString(), per_page: '50' });
            const data = await fetchJson(`${apiUrl}?${params}`, {
                headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/1.0' }
            });

            const listItems = data[listKey];
            const pagination = data.pagination;

            if (!listItems || listItems.length === 0) break;

            const albumsToInsert: any[] = [];

            for (const item of listItems) {
                const info = item.basic_information;
                const existing = await Item.findOne({ discogs_id: info.id, owner: userId }) as any;

                if (existing) {
                    if (full === true && (!existing.tracklist || existing.tracklist.length === 0)) {
                        try {
                            console.log(`🔄 Updating tracklist for existing album ID ${info.id}`);
                            const detailData = await fetchJson(`https://api.discogs.com/releases/${info.id}`, {
                                headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/2.0' }
                            });
                            const fetchedTracklist = detailData.tracklist || [];

                            if (fetchedTracklist.length > 0) {
                                await Item.updateOne(
                                    { _id: existing._id },
                                    { $set: { tracklist: fetchedTracklist } },
                                    { strict: false }
                                );
                            }
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (e) {
                            console.error(`Tracklist update error ID ${info.id}`);
                        }
                    }

                    totalProcessed++;
                    req.io.emit('import_progress', { current: totalProcessed, total: pagination.items });
                    continue;
                }

                let tracklist: any[] = [];
                if (full === true) {
                    try {
                        const detailData = await fetchJson(`https://api.discogs.com/releases/${info.id}`, {
                            headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/1.0' }
                        });
                        tracklist = detailData.tracklist || [];
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (e) { console.error(`Tracklist error ID ${info.id}`); }
                }

                let formatType = [info.formats?.[0]?.name].filter(Boolean);
                let variantColor: string[] = [];
                const firstFormat = info.formats?.[0];
                if (firstFormat) {
                    if (firstFormat.text) {
                        const parts = firstFormat.text.split(',').map((p: string) => p.trim());
                        parts.forEach((part: string) => {
                            if (STANDARD_FORMAT_TERMS.includes(part)) {
                                if (!formatType.includes(part)) formatType.push(part);
                            } else {
                                if (!variantColor.includes(part)) variantColor.push(part);
                            }
                        });
                    }
                    if (firstFormat.descriptions) {
                        firstFormat.descriptions.forEach((d: string) => {
                            if (STANDARD_FORMAT_TERMS.includes(d)) {
                                if (!formatType.includes(d)) formatType.push(d);
                            } else {
                                if (!variantColor.includes(d)) variantColor.push(d);
                            }
                        });
                    }
                }
                const rawFormat = info.formats?.[0]?.name.toLowerCase() || 'vinyl';
                let mediaType = rawFormat.includes('cd') ? 'cd' : (rawFormat.includes('cassette') ? 'cassette' : 'vinyl');

                albumsToInsert.push({
                    title: info.title,
                    artist: info.artists.map((a: any) => a.name).join(', '),
                    year: info.year || 0,
                    label: info.labels?.[0]?.name || 'Unknown',
                    catalog_number: info.labels?.[0]?.catno || '',
                    format_type: formatType.join(', '),
                    variant_color: variantColor.join(', '),
                    media_type: mediaType,
                    cover_image: info.cover_image || info.thumb || '',
                    tracklist,
                    discogs_id: info.id,
                    owner: userId,
                    added_at: new Date(),
                    location: '',
                    genre: info.genres?.[0] || '',
                    genres: info.genres || [],
                    styles: info.styles || [],
                    in_wishlist: isWishlist,
                    kind: 'Music'
                });

                totalProcessed++;
                req.io.emit('import_progress', { current: totalProcessed, total: pagination.items });
            }

            if (albumsToInsert.length > 0) {
                await Vinyl.insertMany(albumsToInsert);
                totalImported += albumsToInsert.length;
            }

            if (page >= pagination.pages) hasMore = false;
            else page++;
        }

        req.io.emit('import_finished', { count: totalImported });

    } catch (err: any) {
        req.io.emit('import_error', { message: err.message });
    }
});

// Musik-Sammler CSV import route
router.post('/import/musik-sammler', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { csv, type } = req.body;
    const userId = req.user._id;

    if (!csv) {
        return res.status(400).json({ error: "Missing CSV data" });
    }

    res.status(202).json({ success: true, message: "Import started" });

    try {
        const rows = parseCSV(csv);
        if (rows.length < 2) {
            req.io.emit('import_error', { message: "CSV file is empty or invalid" });
            return;
        }

        const cleanHeader = (h: string) => h.replace(/^\uFEFF/, '').trim();
        const headerRow = rows[0];
        if (!headerRow) {
            req.io.emit('import_error', { message: "CSV file is empty or invalid" });
            return;
        }
        const headers = headerRow.map(cleanHeader);

        const artistIndex = headers.indexOf('Künstler/Band');
        const countryIndex = headers.indexOf('Land');
        const titleIndex = headers.indexOf('Albumtitel');
        const typeIndex = headers.indexOf('Typ');
        const barcodeIndex = headers.indexOf('EAN/UPC');
        const labelIndex = headers.indexOf('Label');
        const catnoIndex = headers.indexOf('Katalognummer');
        const yearReleaseIndex = headers.indexOf('Veröffentlichungsjahr Tonträger');
        const yearAlbumIndex = headers.indexOf('Veröffentlichungsjahr Album');
        const mfgCountryIndex = headers.indexOf('Herstellungsland');
        const genreIndex = headers.indexOf('Genre');
        const subgenresIndex = headers.indexOf('Untergenres');
        const featuresIndex = headers.indexOf('Besonderheiten');
        const infoIndex = headers.indexOf('Zusatzinformationen');
        const priceIndex = headers.indexOf('Kaufpreis');
        const dateIndex = headers.indexOf('Kaufdatum');
        const locationIndex = headers.indexOf('Kauf-Ort');
        const commentIndex = headers.indexOf('Kommentar');
        const linkCoverIndex = headers.indexOf('Link zum Cover');
        const songsIndex = headers.indexOf('Songtitel');

        if (titleIndex === -1 || artistIndex === -1) {
            req.io.emit('import_error', { message: "Invalid CSV format: Künstler/Band or Albumtitel header missing." });
            return;
        }

        let totalImported = 0;
        let totalProcessed = 0;
        const totalItems = rows.length - 1;

        const isWishlist = (type === 'wishlist');

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            if (row.length < 2 || (row.length === 1 && row[0] === '')) continue; // Skip empty rows

            const title = row[titleIndex]?.trim() || '';
            const artist = row[artistIndex]?.trim() || 'Unknown';

            if (!title) {
                totalProcessed++;
                req.io.emit('import_progress', { current: totalProcessed, total: totalItems });
                continue;
            }

            // Check if already exists
            const existing = await Item.findOne({
                title: { $regex: new RegExp('^' + escapeRegExp(title) + '$', 'i') },
                artist: { $regex: new RegExp('^' + escapeRegExp(artist) + '$', 'i') },
                owner: userId
            });

            if (existing) {
                totalProcessed++;
                req.io.emit('import_progress', { current: totalProcessed, total: totalItems });
                continue;
            }

            let year = '';
            if (yearReleaseIndex > -1 && row[yearReleaseIndex]) {
                year = row[yearReleaseIndex].trim();
            }
            if ((!year || year === '0') && yearAlbumIndex > -1 && row[yearAlbumIndex]) {
                year = row[yearAlbumIndex].trim();
            }

            const label = labelIndex > -1 ? row[labelIndex]?.trim() : '';
            const catalog_number = catnoIndex > -1 ? row[catnoIndex]?.trim() : '';
            const barcode = barcodeIndex > -1 ? row[barcodeIndex]?.trim().replace(/\s/g, '') : '';
            const country = (countryIndex > -1 ? row[countryIndex]?.trim() : '') || (mfgCountryIndex > -1 ? row[mfgCountryIndex]?.trim() : '');

            const rawType = typeIndex > -1 ? row[typeIndex]?.toLowerCase() || '' : '';
            let media_type = 'vinyl';
            if (rawType.includes('cd') || rawType.includes('sacd')) {
                media_type = 'cd';
            } else if (rawType.includes('cassette') || rawType.includes('mc') || rawType.includes('kassette')) {
                media_type = 'cassette';
            }
            const format_type = typeIndex > -1 ? row[typeIndex]?.trim() : 'Vinyl';

            const variant_color = featuresIndex > -1 ? row[featuresIndex]?.trim() : '';

            // Comments compilation
            let commentsParts = [];
            const customComment = commentIndex > -1 ? row[commentIndex]?.trim() : '';
            if (customComment) {
                commentsParts.push(customComment);
            }
            const addInfo = infoIndex > -1 ? row[infoIndex]?.trim() : '';
            if (addInfo) {
                commentsParts.push(`Zusatzinfo: ${addInfo}`);
            }
            const price = priceIndex > -1 ? row[priceIndex]?.trim() : '';
            const date = dateIndex > -1 ? row[dateIndex]?.trim() : '';
            const buyPlace = locationIndex > -1 ? row[locationIndex]?.trim() : '';

            let purchaseInfo = [];
            if (price && price !== '0.00' && price !== '0') purchaseInfo.push(`${price} €`);
            if (date) purchaseInfo.push(date);
            if (buyPlace) purchaseInfo.push(buyPlace);

            if (purchaseInfo.length > 0) {
                commentsParts.push(`Achat: ${purchaseInfo.join(' - ')}`);
            }
            const comments = commentsParts.join('\n\n');

            const cover_image = linkCoverIndex > -1 ? row[linkCoverIndex]?.trim() : '';

            const mainGenre = genreIndex > -1 ? row[genreIndex]?.trim() : '';
            const subGenresRaw = subgenresIndex > -1 ? row[subgenresIndex]?.trim() : '';
            const parsedSubgenres = subGenresRaw ? subGenresRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

            const genres = [mainGenre].filter(Boolean);
            const styles = parsedSubgenres;
            const genre = mainGenre || '';

            // Tracklist parsing
            const tracklist = [];
            if (songsIndex > -1 && songsIndex < row.length) {
                let trackNum = 1;
                for (let s = songsIndex; s < row.length; s++) {
                    const rawSong = row[s]?.trim();
                    if (!rawSong) continue;

                    // Skip numeric count
                    if (s === songsIndex && /^\d+$/.test(rawSong)) {
                        continue;
                    }

                    const match = rawSong.match(/^(.*?)\s*\((\d{2}:\d{2}:\d{2}|\d{2}:\d{2})\)$/);
                    let sTitle = rawSong;
                    let sDuration = '';
                    if (match) {
                        sTitle = match[1]!.trim();
                        sDuration = match[2]!.trim();
                    }

                    tracklist.push({
                        position: trackNum.toString(),
                        title: sTitle,
                        duration: sDuration
                    });
                    trackNum++;
                }
            }

            await Vinyl.create({
                title,
                artist,
                year,
                label,
                catalog_number,
                format_type,
                variant_color,
                cover_image,
                tracklist,
                media_type,
                in_wishlist: isWishlist,
                owner: userId,
                comments,
                location: '',
                genre,
                genres,
                styles,
                barcode,
                added_at: new Date()
            });

            totalImported++;
            totalProcessed++;
            req.io.emit('import_progress', { current: totalProcessed, total: totalItems });
        }

        req.io.emit('import_finished', { count: totalImported });

    } catch (err: any) {
        console.error("Musik-Sammler import error:", err);
        req.io.emit('import_error', { message: err.message });
    }
});

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCSV(text: string): string[][] {
    const lines: string[][] = [];
    let row = [""];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        const next = text[i + 1];
        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] = (row[row.length - 1] ?? '') + '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') {
                i++;
            }
            lines.push(row);
            row = [''];
        } else {
            row[row.length - 1] = (row[row.length - 1] ?? '') + c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }
    return lines;
}

// API route to import tracklist from Discogs
router.post('/api/album/:id/import-tracklist', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { discogsId } = req.body;
    const albumId = req.params.id;
    const token = process.env.DISCOGS_TOKEN;

    if (!discogsId) {
        return res.status(400).json({ success: false, error: "ID Discogs missing" });
    }

    try {
        const data = await fetchJson(`https://api.discogs.com/releases/${discogsId}`, {
            headers: { 'User-Agent': 'DVinylApp/1.0', 'Authorization': `Discogs token=${token}` }
        });

        const tracklist = data.tracklist;

        if (!tracklist || tracklist.length === 0) {
            return res.status(404).json({ success: false, error: "No tracklist found on Discogs" });
        }

        await Item.findByIdAndUpdate(albumId, { tracklist: tracklist }, { strict: false });
        res.status(200).json({ success: true });

    } catch (err: any) {
        console.error("Erreur API Discogs:", err.message);
        res.status(500).json({ success: false, error: "Error during Discogs API call" });
    }
});

// API route to refresh all album metadata from Discogs
router.post('/api/album/:id/refresh-info', requireAuth, requireAdmin, async (req: any, res: any) => {
    const albumId = req.params.id;
    const { discogsId } = req.body;
    const token = process.env.DISCOGS_TOKEN;

    if (!discogsId) {
        return res.status(400).json({ success: false, error: "Discogs ID missing" });
    }

    try {
        const data = await fetchJson(`https://api.discogs.com/releases/${discogsId}`, {
            headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/2.0' }
        });

        const updateData: any = {
            genres: data.genres || [],
            styles: data.styles || [],
            tracklist: data.tracklist || []
        };

        const currentAlbum = await Item.findById(albumId);

        // Only update barcode if not locked
        if (currentAlbum && !currentAlbum.barcode_locked) {
            let barcode = '';
            if (data.identifiers && data.identifiers.length > 0) {
                const barcodeObj = data.identifiers.find((id: any) => id.type === 'Barcode');
                if (barcodeObj) {
                    barcode = barcodeObj.value.replace(/\s/g, '');
                }
            }
            if (barcode) updateData.barcode = barcode;
        }

        // For backward compatibility: update the single genre field if it's currently empty
        if (currentAlbum && (!currentAlbum.genre || currentAlbum.genre === '') && data.genres && data.genres.length > 0) {
            updateData.genre = data.genres[0];
        }

        await Item.findByIdAndUpdate(albumId, { $set: updateData }, { strict: false });

        res.json({ success: true, genres: updateData.genres, styles: updateData.styles });
    } catch (err) {
        console.error("Refresh info error:", err);
        res.status(500).json({ success: false, error: req.t('detail.refresh_info_error') });
    }
});

export = router;
