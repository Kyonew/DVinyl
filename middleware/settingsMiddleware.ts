import Settings from '../models/Settings';
import themesConfig from '../config/themes';
import { BASE_URL } from '../config/constants';
import { registry } from '../core/registry';

async function settingsMiddleware(req: any, res: any, next: any) {
    try {
        res.locals.allThemes = themesConfig;

        // Settings are scoped per collection (one document per collection, like
        // independent containers). Requires collectionMiddleware to have run first.
        const activeCollectionId = res.locals.activeCollectionId;

        let dbSettings = null;
        if (activeCollectionId) {
            // Atomic upsert (+ the unique index on `collection` in models/Settings.ts):
            // concurrent first-visits to a brand-new collection (e.g. the page load and
            // its automatic manifest.json fetch) must not create two Settings documents.
            dbSettings = await Settings.findOneAndUpdate(
                { collection: activeCollectionId },
                { $setOnInsert: { collection: activeCollectionId } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean();
        }

        // All defaults derive from the registered plugins (anonymous requests / fresh install)
        const defaultSettings = {
            siteName: 'DVinyl',
            modules: registry.getDefaultModules(),
            navbarShortcuts: registry.getDefaultNavbarShortcuts(),
            statsWidgets: registry.getDefaultStatsWidgets(),
            theme: registry.getDefaultThemes(),
            aspectRatioClass: 'aspect-square',
            pluginSettings: registry.getDefaultPluginSettings()
        };

        const settings = dbSettings || defaultSettings;

        settings.pluginSettings = settings.pluginSettings || registry.getDefaultPluginSettings();

        settings.navbarShortcuts = settings.navbarShortcuts || registry.getDefaultNavbarShortcuts();
        settings.statsWidgets = settings.statsWidgets || registry.getDefaultStatsWidgets();

        res.locals.settings = settings;

        res.locals.currentLng = res.locals.user?.language || req.language || 'fr';
        res.locals.isDark = res.locals.user ? (res.locals.user.theme === 'dark') : true;

        const fullPath = req.path.toLowerCase();
        // Strip BASE_URL from path to avoid false positives if BASE_URL contains keywords like "vinyl"
        const path = fullPath.startsWith(BASE_URL.toLowerCase())
            ? fullPath.slice(BASE_URL.length)
            : fullPath;

        const queryType = req.query.type;

        // Matched segment by segment, never as a bare substring of the whole URL: ids that
        // travel in a path are hex (share tokens, ObjectIds), so about one in seven of them
        // contains "cd" and used to be read as the music module (pathAliases). The request
        // then 404'd whenever that module was off, which made a share link's QR code and
        // its delete button fail, and a collection impossible to delete.
        // Route shapes to keep matching: /album/:id, /add-music, /save-books,
        // /confirm-dvd/:id, /import/discogs. Hence "segment equals it" or "one of its
        // hyphen-separated parts is it".
        const segments: string[] = path.split('/').filter(Boolean);
        const pathHasSegment = (needle: string) => {
            const target = needle.replace(/^\//, '').toLowerCase();
            return target !== '' && segments.some(seg =>
                seg === target || seg.split('-').includes(target)
            );
        };

        let detectedType = 'home';
        const foundPlugin = registry.getAll().find(p =>
            pathHasSegment(p.routePrefix) ||
            pathHasSegment(p.id) ||
            pathHasSegment(p.collectionType) ||
            (p.pathAliases || []).some(alias => pathHasSegment(alias))
        );
        if (foundPlugin) {
            // Use collectionType: it keys settings.modules and matches the ?type= query param,
            // so module gating and category detection stay correct even if id !== collectionType.
            detectedType = foundPlugin.collectionType;
        }

        res.locals.detectedType = detectedType;
        const activeType = queryType || detectedType;

        res.locals.currentType = activeType;

        const isAllowedAction = req.method === 'DELETE' || path.startsWith('/api/') ||
            registry.getAll().some(p => path.includes(p.routePrefix) || path.includes(`/save-${p.id}`));

        if (detectedType !== 'home') {
            const isEnabled = settings.modules && (
                (settings.modules as any)[detectedType] || 
                (settings.modules instanceof Map ? settings.modules.get(detectedType) : false)
            );
            if (!isEnabled && path !== '/' && !isAllowedAction) {
                return res.status(404).render('404');
            }
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
