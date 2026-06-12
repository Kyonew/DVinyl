import Settings from '../models/Settings';
import themesConfig from '../config/themes';
import { BASE_URL } from '../config/constants';

async function settingsMiddleware(req: any, res: any, next: any) {
    try {
        res.locals.allThemes = themesConfig;

        const dbSettings = await Settings.findOne().lean();

        const defaultSettings = {
            siteName: 'DVinyl',
            modules: { music: true, books: false, dvd: false, games: false, advancedCD: false },
            navbarShortcuts: ['global_home', 'music_vinyl', 'music_cd', 'music_cassette', 'global_wishlist'],
            statsWidgets: ['total', 'vinyl', 'cd', 'cassette', 'artist'],
            theme: {
                home: { preset: 'default' },
                music: { preset: 'default' },
                books: { preset: 'default' },
                dvd: { preset: 'default' },
                games: { preset: 'default' }
            }
        };

        const settings = dbSettings || defaultSettings;

        if (!settings.navbarShortcuts) {
            settings.navbarShortcuts = ['global_home', 'music_vinyl', 'music_cd', 'music_cassette', 'global_wishlist'];
        }
        if (!settings.statsWidgets) {
            settings.statsWidgets = ['total', 'vinyl', 'cd', 'cassette', 'artist'];
        }


        settings.navbarShortcuts = settings.navbarShortcuts || ['global_home', 'music_vinyl', 'music_cd', 'music_cassette', 'global_wishlist'];
        settings.statsWidgets = settings.statsWidgets || ['total', 'vinyl', 'cd', 'cassette', 'artist'];

        res.locals.settings = settings;

        res.locals.currentLng = res.locals.user?.language || req.language || 'fr';
        res.locals.isDark = res.locals.user ? (res.locals.user.theme === 'dark') : true;

        const fullPath = req.path.toLowerCase();
        // Strip BASE_URL from path to avoid false positives if BASE_URL contains keywords like "vinyl"
        const path = fullPath.startsWith(BASE_URL.toLowerCase())
            ? fullPath.slice(BASE_URL.length)
            : fullPath;

        const queryType = req.query.type; // ex: ?type=books

        let detectedType = 'home';

        if (path.includes('vinyl') || path.includes('search-discogs') || path.includes('cd') || path.includes('cassette') || path.includes('album') || path.includes('music')) {
            detectedType = 'music';
        } else if (path.includes('book') || path.includes('books')) {
            detectedType = 'books';
        } else if (path.includes('game') || path.includes('games')) {
            detectedType = 'games';
        } else if (path.includes('dvd')) {
            detectedType = 'dvd';
        }

        res.locals.detectedType = detectedType;
        const activeType = queryType || detectedType;

        res.locals.currentType = activeType;

        const isAllowedAction = req.method === 'DELETE' || path.startsWith(BASE_URL + '/api/') ||
            path.includes('/book/') || path.includes('/dvd/') || path.includes('/game/') || path.includes('/album/') ||
            path.includes('/save-');

        if (activeType === 'books' && !settings.modules?.books && path !== '/' && !isAllowedAction) {
            return res.status(404).render('404');
        }
        if (activeType === 'dvd' && !settings.modules?.dvd && path !== '/' && !isAllowedAction) {
            return res.status(404).render('404');
        }
        if (activeType === 'games' && !settings.modules?.games && path !== '/' && !isAllowedAction) {
            return res.status(404).render('404');
        }

        next();
    } catch (err) {
        console.error("[ERR] SettingsMiddleware:", err);
        res.locals.isDark = true;
        res.locals.currentLng = 'fr';
        res.locals.settings = { theme: { home: { preset: 'default' } } };
        next();
    }
}

export = settingsMiddleware;
