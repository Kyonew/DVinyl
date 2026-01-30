// Licensed under MIT

/**
 * app.js
 *
 * Express application entrypoint. Sets up i18n, global middleware,
 * route mounting, database connection and sockets. Intended for local
 * development and small deployments; review security settings for
 * production use.
 */
const express = require('express');
const session = require('express-session');
const path = require('path');
const { checkUser } = require('./middleware/authMiddleware.js');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require("socket.io");
require("dotenv").config();

const i18next = require('i18next');
const i18nMiddleware = require('i18next-http-middleware');


// Models
const User = require('./models/User.js');
const BlockedIP = require('./models/blockedIP.js');

// Routes imports
const setupRoutes = require('./routes/setupRoutes');
const authRoutes = require('./routes/authRoutes.js');
const albumRoutes = require('./routes/albumRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');
const settingsRoutes = require('./routes/settingsRoutes.js');
const backupRoutes = require('./routes/backupRoutes.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);


i18next
  .use(i18nMiddleware.LanguageDetector) // Detect language via query/cookie/header
  .init({
    fallbackLng: 'fr',
    preload: ['fr', 'en'],
    resources: {
      en: { translation: require('./locales/en.json') },
      fr: { translation: require('./locales/fr.json') }
    },
    detection: {
      order: ['querystring', 'cookie', 'header'], // detection order
      caches: ['cookie']
    }
  });


// Basic configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('io', io); // Expose io to routes

// Global middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '../website/public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());


app.use(i18nMiddleware.handle(i18next));


app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.PROD === 'true', httpOnly: true },
}));

if (process.env.PROD === 'true') {
  app.set('trust proxy', 1); // Trust first proxy
}

app.use(async (req, res, next) => {
  // If the user is authenticated and has a language preference, enforce it
  if (req.user && req.user.language) {
    await req.i18n.changeLanguage(req.user.language);
  }

  // Make translation helper and current language available to all EJS views
  res.locals.t = req.t;
  res.locals.currentLng = req.language;
  req.io = io;
  next();
});


// Inject IO object into requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Security: IP blocking middleware
app.use(async (req, res, next) => {
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
app.use(checkUser);

// Installation gatekeeper middleware
app.use(async (req, res, next) => {
    // Ignore paths that should not be redirected during setup
    if (req.path.startsWith('/setup') || 
      req.path.startsWith('/ressources') || 
      req.path.startsWith('/styles') ||
      req.path.startsWith('/login') ||
      req.path.startsWith('/backup') ) { // allow login and backup import while setting up
        return next();
    }

    try {
        const count = await User.countDocuments();
        console.log(`[DEBUG] Number of users in DB: ${count}`);

        if (count === 0) {
            console.log("[DEBUG] DB empty -> redirecting to /setup");
            return res.redirect('/setup');
        }
    } catch (e) {
        console.error("Check setup error:", e);
    }
    
    next();
});



// Route mounting
app.use('/setup', setupRoutes);
app.use(authRoutes);
app.use(albumRoutes);
app.use('/admin', adminRoutes);
app.use('/settings', settingsRoutes);
app.use('/backup', backupRoutes);


// Database connection and server start
const dbURI = process.env.MONGODB_URL; ;
mongoose.connect(dbURI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(process.env.VINYL_PORT, () => {
        console.log(`🚀 Server started on port ${process.env.VINYL_PORT}`);
    });
  })
  .catch((err) => console.log('❌DB Error:', err));


// Socket event
// io.on('connection', (socket) => {
//   console.log('Connected socket :', socket.id);
// });