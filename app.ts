import express from 'express';
import session from 'express-session';
import path from 'path';
import { checkUser } from './middleware/authMiddleware.js';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import http from 'http';
import { Server } from "socket.io";

import i18next from 'i18next';
import i18nMiddleware from 'i18next-http-middleware';

import settingsMiddleware from './middleware/settingsMiddleware.js';
import collectionMiddleware from './middleware/collectionMiddleware.js';
import themesConfig from './config/themes.js';
import { BASE_URL, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguage, dateLocaleFor } from './config/constants.js';
import { isOidcEnabled, getOidcButtonLabel, isLocalLoginDisabled } from './config/oidc.js';
import { connectDB } from './config/db.js';
import { migrateDatabase } from './utils/migrate.js';

// Models
import User from './models/User.js';
import BlockedIP from './models/blockedIP.js';

// Core & Registry
import { registry } from './core/registry.js';
import { loadPlugins } from './core/loadPlugins.js';
import { syncCustomPluginsOnBoot } from './core/customPluginSync.js';
import { mountPluginRoutes, pluginDispatcher } from './core/pluginRuntime.js';
import { applyPluginCustomization } from './core/pluginCustomization.js';
import { getCardLines, getCornerBadge, CORNER_POSITIONS, DEFAULT_CORNER_POSITION } from './core/cardFields.js';
import { importableFields } from './core/csvMapping.js';

// Routes imports
import setupRoutes from './routes/setupRoutes.js';
import pluginBuilderRoutes from './routes/pluginBuilderRoutes.js';
import pluginAssetRoutes from './routes/pluginAssetRoutes.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import backupRoutes from './routes/backupRoutes.js';
import oidcRoutes from './routes/oidcRoutes.js';

import dashboardRoute from './core/routes/dashboardRoute.js';
import collectionRoute from './core/routes/collectionRoute.js';
import manualAddRoute from './core/routes/manualAddRoute.js';
import csvImportRoute from './core/routes/csvImportRoute.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: BASE_URL + '/socket.io',
});


i18next
  .use(i18nMiddleware.LanguageDetector) // Detect language via query/cookie/header
  .init({
    fallbackLng: DEFAULT_LANGUAGE,
    // Without these two, req.language keeps the regional tag the browser sends
    // ('fr-FR'). It is stored on the user and used as a lookup key (TMDB), both of
    // which only know the short codes, so the language is resolved to one of them here.
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: true,
    preload: [...SUPPORTED_LANGUAGES],
    resources: {
      en: { translation: require('./locales/en.json') },
      fr: { translation: require('./locales/fr.json') },
      es: { translation: require('./locales/es.json') },
      it: { translation: require('./locales/it.json') },
      de: { translation: require('./locales/de.json') }
    },
    detection: {
      order: ['querystring', 'cookie', 'header'], // detection order
      caches: ['cookie']
    }
  });


// Basic configuration
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views'), path.join(__dirname, 'core/views')]);
// Card bodies are resolved from the plugin declarations, not inlined per grid
app.locals.getCardLines = getCardLines;
app.locals.getCornerBadge = getCornerBadge;
app.locals.CORNER_POSITIONS = CORNER_POSITIONS;
app.locals.DEFAULT_CORNER_POSITION = DEFAULT_CORNER_POSITION;
// The CSV mapping screen lists the destinations of every enabled module
app.locals.importableFields = importableFields;
// Dates read the same way wherever a view prints one
app.locals.dateLocaleFor = dateLocaleFor;
app.set('io', io); // Expose io to routes

// Global middlewares
app.use(BASE_URL, express.static(path.join(__dirname, 'public')));
// Mounted with the static assets: no session, no settings, no collection lookup needed
app.use(BASE_URL + '/plugin-assets', pluginAssetRoutes);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());


app.use(i18nMiddleware.handle(i18next));

const session_secret = process.env.SESSION_SECRET;
if (!session_secret) {
  throw new Error('SESSION_SECRET is not defined');
}
app.use(session({
  secret: session_secret,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.PROD === 'true', httpOnly: true },
}));

if (process.env.PROD === 'true') {
  app.set('trust proxy', 1); // Trust first proxy
}

const pkg = require('./package.json');

// Incext BASE_URL in each res.redirect call
app.use((req, res, next) => {
  const redirect = res.redirect as any;

  res.redirect = function (url: any) {
    if (url.startsWith('/') && !url.startsWith(BASE_URL)) {
      return redirect.call(res, `${BASE_URL}${url}`);
    } else {
      return redirect.call(res, url);
    }
  } as any;

  next();
});

app.use(checkUser);

app.use(async (req: any, res, next) => {
  // The preference of an authenticated user wins, otherwise the detected language.
  // Detection hands back the tag the browser sent, region included ('fr-FR'), and
  // changeLanguage is what rewrites req.language, so it runs on every request: the
  // value travels into the User schema (enum) and into provider lookups keyed by the
  // short code, neither of which knows a regional tag.
  const language = normalizeLanguage(req.user?.language || req.language);
  if (language !== req.language) {
    await req.i18n.changeLanguage(language);
  }

  // Make translation helper and current language available to all EJS views
  res.locals.t = req.t;
  res.locals.currentLng = req.language;
  res.locals.appVersion = pkg.version;
  res.locals.baseUrl = BASE_URL;
  res.locals.oidcEnabled = isOidcEnabled();
  res.locals.oidcButtonLabel = getOidcButtonLabel();
  res.locals.localLoginDisabled = isLocalLoginDisabled();
  req.io = io;
  next();
});


// Inject IO object into requests
app.use((req: any, res, next) => {
  req.io = io;
  next();
});

// Security: IP blocking middleware
app.use(async (req: any, res, next) => {
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  try {
    const blocked = await BlockedIP.findOne({ ip: clientIP });
    if (blocked) return res.status(403).send(req.t('common.forbidden'));
    next();
  } catch (err) {
    console.error('IP error:', err);
    next();
  }
});

// Resolve the active collection for the logged-in user. Must run BEFORE
// settingsMiddleware: settings are per-collection and need activeCollectionId.
app.use(collectionMiddleware);

// Load the active collection's settings (per-collection container)
app.use(settingsMiddleware);

// Installation gatekeeper middleware
app.use(async (req, res, next) => {
  // Ignore paths that should not be redirected during setup
  if (req.path.startsWith(BASE_URL + '/setup') ||
    req.path.startsWith(BASE_URL + '/ressources') ||
    req.path.startsWith(BASE_URL + '/styles') ||
    req.path.startsWith(BASE_URL + '/login') ||
    req.path.startsWith(BASE_URL + '/backup')) { // allow login and backup import while setting up
    return next();
  }

  try {
    const count = await User.countDocuments();
    if (count === 0) {
      return res.redirect(BASE_URL + '/setup');
    }
  } catch (e) {
    console.error("Check setup error:", e);
  }

  next();
});

app.use((req, res, next) => {
  res.locals.allThemes = themesConfig;
  // Views read the registry through a per-request facade so the active
  // collection's cosmetic overrides (settings.pluginCustomization) apply
  applyPluginCustomization(res);
  next();
});


// Dynamic manifest.json endpoint - injects BASE_URL
app.get(BASE_URL + '/manifest.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.render(path.join(__dirname, 'public-tpl', 'manifest.json.ejs'));
});

// Dynamic service worker endpoint - injects BASE_URL
app.get(BASE_URL + '/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Service-Worker-Allowed', BASE_URL || '/');
  res.render(path.join(__dirname, 'public-tpl', 'sw.js.ejs'));
});


// Auto-discover and register every plugin under plugins/
loadPlugins();

// Route mounting
app.use(BASE_URL + '/setup', setupRoutes);
app.use(BASE_URL, authRoutes);
app.use(BASE_URL + '/admin', adminRoutes);
app.use(BASE_URL + '/settings', settingsRoutes);
app.use(BASE_URL + '/create-plugin', pluginBuilderRoutes);
app.use(BASE_URL + '/backup', backupRoutes);
if (isOidcEnabled()) {
  app.use(BASE_URL, oidcRoutes);
}

app.use(BASE_URL, dashboardRoute);
app.use(BASE_URL, collectionRoute);
app.use(BASE_URL, manualAddRoute);
// Before the plugin dispatcher, which also serves /import/:id routes
app.use(BASE_URL, csvImportRoute);

// Plugin routers live behind a runtime dispatcher (not mounted directly on `app`)
// so custom plugins created via /create-plugin are reachable without a restart.
for (const plugin of registry.getAll()) {
  mountPluginRoutes(plugin);
}
app.use(BASE_URL, pluginDispatcher);

app.use((req, res) => {
  res.status(404).render('404');
});

// Database connection and server start
connectDB()
  .then(async () => {
    console.log('[BOOT] Running database migrations...');
    await migrateDatabase();
    // Re-materialize no-code plugins from the DB: re-grows plugins/<id>/ folders on
    // a fresh/rebuilt container and backfills the DB from any pre-existing folders.
    console.log('[BOOT] Syncing custom plugins...');
    await syncCustomPluginsOnBoot();
    const port = process.env.VINYL_PORT || 3099;
    server.listen(port, () => {
      console.log(`[BOOT] Server started on port ${port} (BASE_URL="${BASE_URL || '/'}", env=${process.env.PROD === 'true' ? 'production' : 'development'})`);
    });
  })
  .catch((err: any) => console.error('[BOOT] DB Error:', err));


// Socket event
// io.on('connection', (socket) => {
//   console.log('Connected socket :', socket.id);
// });
