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
import themesConfig from './config/themes.js';
import { BASE_URL } from './config/constants.js';
import { connectDB } from './config/db.js';
import { migrateDatabase } from './utils/migrate.js';

// Models
import User from './models/User.js';
import BlockedIP from './models/blockedIP.js';

// Core & Registry
import { registry } from './core/registry.js';
import { loadPlugins } from './core/loadPlugins.js';

// Routes imports
import setupRoutes from './routes/setupRoutes.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import backupRoutes from './routes/backupRoutes.js';

import dashboardRoute from './core/routes/dashboardRoute.js';
import collectionRoute from './core/routes/collectionRoute.js';
import manualAddRoute from './core/routes/manualAddRoute.js';
import { createItemRoutes } from './core/routes/itemRoutes.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: BASE_URL + '/socket.io',
});


i18next
  .use(i18nMiddleware.LanguageDetector) // Detect language via query/cookie/header
  .init({
    fallbackLng: 'fr',
    preload: ['fr', 'en', 'es', 'it', 'de'],
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
app.set('io', io); // Expose io to routes

// Global middlewares
app.use(BASE_URL, express.static(path.join(__dirname, 'public')));
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
  // If the user is authenticated and has a language preference, enforce it
  if (req.user && req.user.language) {
    await req.i18n.changeLanguage(req.user.language);
  }

  // Make translation helper and current language available to all EJS views
  res.locals.t = req.t;
  res.locals.currentLng = req.language;
  res.locals.appVersion = pkg.version;
  res.locals.baseUrl = BASE_URL;
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

// Check user middleware (populate res.locals.user for all views)
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
  res.locals.registry = registry;
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
app.use(BASE_URL + '/backup', backupRoutes);

app.use(BASE_URL, dashboardRoute);
app.use(BASE_URL, collectionRoute);
app.use(BASE_URL, manualAddRoute);

for (const plugin of registry.getAll()) {
  app.use(BASE_URL, createItemRoutes(plugin));
}

app.use((req, res) => {
  res.status(404).render('404');
});

// Database connection and server start
connectDB()
  .then(async () => {
    await migrateDatabase();
    const port = process.env.VINYL_PORT || 3099;
    server.listen(port, () => {
      console.log(`🚀 Server started on port ${port}`);
    });
  })
  .catch((err: any) => console.log('❌DB Error:', err));


// Socket event
// io.on('connection', (socket) => {
//   console.log('Connected socket :', socket.id);
// });
