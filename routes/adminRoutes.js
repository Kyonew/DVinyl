const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../models/User");
const BlockedIP = require("../models/blockedIP");
const LoginLog = require("../models/LoginLog");
const Settings = require("../models/Settings");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const PRESETS = require("../config/themes");
const axios = require("axios");
const https = require("https");
const Item = require("../models/Item");
const Vinyl = require("../models/Vinyl");
const Book = require("../models/Book");
const Dvd = require("../models/Dvd");
const Game = require("../models/Game");
const { BOOK_GENRES_WHITELIST, TMDB_LANG_MAP } = require("../config/constants");
const { igdbRequest } = require("../utils/igdbHelper");

/**
 * routes/adminRoutes.js
 *
 * Administration routes: user management, IP blocking and login logs.
 */

/**
 * Generate a random password.
 * @param {number} [length=12]
 * @returns {string}
 */
const createPassword = (length = 12) => {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

/**
 * Helper to escape regular expression special characters.
 * @param {string} string
 * @returns {string}
 */
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Helper to load the common admin data used by the dashboard view.
 * Centralizing this avoids duplicating queries across handlers.
 */
async function loadAdminData() {
  const users = await User.find().sort({ lastChange: -1 });
  const blockedIps = await BlockedIP.find().sort({ createdAt: -1 });
  const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(20);

  // Get distinct genres grouped by kind
  const admin = await User.findOne({ isAdmin: true }).select("_id");
  const adminId = admin ? admin._id : null;

  const pipeline = [
    { $match: { owner: adminId } },
    {
      $project: {
        kind: 1,
        allGenres: {
          $concatArrays: [
            { $cond: [{ $in: ["$genre", ["", null]] }, [], ["$genre"]] },
            { $ifNull: ["$genres", []] },
            { $ifNull: ["$styles", []] },
          ],
        },
      },
    },
    { $unwind: "$allGenres" },
    {
      $group: {
        _id: "$kind",
        genres: { $addToSet: "$allGenres" },
      },
    },
  ];

  const genreGroupsRaw = await Item.aggregate(pipeline);

  const allGenres = {};
  genreGroupsRaw.forEach((group) => {
    if (group._id && group.genres && group.genres.length > 0) {
      allGenres[group._id] = group.genres.filter(Boolean).sort();
    }
  });

  const visibilitySettings =
    (await Settings.findOne().populate("visibility.hiddenItems").lean()) || {};

  return { users, blockedIps, logs, allGenres, visibilitySettings };
}

// DASHBOARD (GET)
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await loadAdminData();

    // Read optional message key from query and translate in the view.
    const msgKey = req.query.msg;

    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: msgKey ? req.t(`messages.${msgKey}`) : null,
      newPassword: null,
      hasHardcoverKey: !!process.env.HARDCOVER_API_KEY,
      hasTmdbKey: !!process.env.TMDB_API_KEY,
      hasIgdbKey: !!(
        process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET
      ),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(req.t("errors.generic_server_error"));
  }
});

// Add user (POST)
router.post("/add-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, email } = req.body;
    const password = createPassword();
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user then force-update the stored password hash.
    const newUser = await User.create({
      username,
      email,
      password: password,
      lastChange: new Date(),
    });

    await User.updateOne(
      { _id: newUser._id },
      { $set: { password: hashedPassword } },
    );

    // Reload admin data (including logs) for the rendered view.
    const data = await loadAdminData();

    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: `Utilisateur ${username} créé !`,
      newPassword: password,
    });
  } catch (err) {
    console.error("Creation error:", err);
    res.redirect("/admin?msg=user_created");
  }
});

// Reset password (POST)
router.post("/reset-password", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    const userToUpdate = await User.findById(userId);

    if (userToUpdate) {
      const password = createPassword();
      const hashedPassword = await bcrypt.hash(password, 10);

      await User.updateOne(
        { _id: userId },
        { $set: { password: hashedPassword, lastChange: new Date() } },
      );

      // Reload data for the view after change.
      const data = await loadAdminData();

      res.render("admin", {
        ...data,
        user: res.locals.user,
        successMessage: req.t("messages.password_reset_success", {
          name: userToUpdate.username,
        }),
        newPassword: password,
      });
    } else {
      res.redirect("/admin");
    }
  } catch (err) {
    console.error(err);
    res.redirect("/admin");
  }
});

// 4. Simple actions (redirects)
// These handlers redirect back to the admin root and therefore do not
// need to reload the logs.
router.post("/delete-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.body.userId === res.locals.user._id.toString())
      return res.redirect("/admin?msg=delete_self_error");
    await User.findByIdAndDelete(req.body.userId);
    res.redirect("/admin?msg=user_deleted");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.post("/block-ip", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ipAddress } = req.body;
    const exists = await BlockedIP.findOne({ ip: ipAddress });
    if (!exists) await BlockedIP.create({ ip: ipAddress });
    res.redirect("/admin?msg=ip_blocked");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.post("/unblock-ip", requireAuth, requireAdmin, async (req, res) => {
  try {
    await BlockedIP.findByIdAndDelete(req.body.ipId);
    res.redirect("/admin?msg=ip_unblocked");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.get("/personnalisation", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.render("personnalisation", {
      presets: PRESETS,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("ERR");
  }
});

router.post(
  "/personnalisation/save",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        homePreset,
        musicPreset,
        booksPreset,
        dvdPreset,
        gamesPreset,
        navbarShortcuts,
        statsWidgets,
      } = req.body;

      const shortcuts = Array.isArray(navbarShortcuts)
        ? navbarShortcuts
        : navbarShortcuts
          ? [navbarShortcuts]
          : [];
      const stats = Array.isArray(statsWidgets)
        ? statsWidgets
        : statsWidgets
          ? [statsWidgets]
          : [];

      const validFastAdd = [
        "",
        "vinyl",
        "cd",
        "cassette",
        "book",
        "dvd",
        "game",
      ];
      const fastAdd = validFastAdd.includes(req.body.fastAdd)
        ? req.body.fastAdd
        : "";

      const update = {
        "theme.home.preset": homePreset,
        "theme.music.preset": musicPreset,
        "theme.books.preset": booksPreset,
        "theme.dvd.preset": dvdPreset,
        "theme.games.preset": gamesPreset,
        navbarShortcuts: shortcuts,
        statsWidgets: stats,
        fastAdd: fastAdd,
      };

      await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

      res.redirect("/admin/personnalisation?msg=saved");
    } catch (err) {
      console.error("[ERR] perso save", err);
      res.status(500).send("[ERR] perso save failed.");
    }
  },
);

router.post("/modules/save", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      musicActive,
      booksActive,
      dvdActive,
      gamesActive,
      advancedCDActive,
    } = req.body;

    if (!musicActive && !booksActive && !dvdActive && !gamesActive) {
      return res.redirect("/admin?msg=error_no_module");
    }

    const update = {
      "modules.music": musicActive === "on",
      "modules.books": booksActive === "on",
      "modules.dvd": dvdActive === "on",
      "modules.games": gamesActive === "on",
      "modules.advancedCD": advancedCDActive === "on",
    };

    await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

    res.redirect("/admin?msg=saved");
  } catch (err) {
    console.error("[ERR] modules save", err);
    res.status(500).send("[ERR] modules save failed.");
  }
});

router.post("/visibility/save", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { applyToAdmin, hiddenItems, hiddenGenres, hiddenTypes } = req.body;

    let parsedItems = [];
    if (hiddenItems) {
      try {
        parsedItems = JSON.parse(hiddenItems);
      } catch (e) {
        parsedItems = [];
      }
    }

    const applyToAdminVal =
      applyToAdmin === "on" || applyToAdmin === "true" || applyToAdmin === true;
    const update = {
      "visibility.applyToAdmin": applyToAdminVal,
      "visibility.hiddenItems": parsedItems,
      "visibility.hiddenGenres": Array.isArray(hiddenGenres)
        ? hiddenGenres
        : hiddenGenres
          ? [hiddenGenres]
          : [],
      "visibility.hiddenTypes": Array.isArray(hiddenTypes)
        ? hiddenTypes
        : hiddenTypes
          ? [hiddenTypes]
          : [],
    };

    await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

    res.redirect("/admin?msg=saved");
  } catch (err) {
    console.error("[ERR] visibility save", err);
    res.status(500).send("[ERR] visibility save failed.");
  }
});

router.post(
  "/batch-update-barcodes",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { barcodeList } = req.body;
      if (!barcodeList) return res.redirect("/admin?msg=error");

      const lines = barcodeList
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.includes(":"));
      let count = 0;

      for (const line of lines) {
        const [discogsId, barcode] = line.split(":").map((s) => s.trim());
        if (discogsId && barcode) {
          const result = await Item.updateMany(
            { discogs_id: parseInt(discogsId), kind: "Music" },
            { $set: { barcode: barcode, barcode_locked: true } },
          );
          count += result.modifiedCount;
        }
      }

      res.redirect(`/admin?msg=batch_barcode_success&count=${count}`);
    } catch (err) {
      console.error("[ERR] batch-update-barcodes", err);
      res.redirect("/admin?msg=error");
    }
  },
);

router.get(
  "/api/search-collection",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
        const { q } = req.query;
        const trimmedQ = typeof q === 'string' ? q.trim() : '';
        if (!trimmedQ) return res.json([]);

        const admin = await User.findOne({ isAdmin: true }).select('_id');
        const adminId = admin ? admin._id : null;

        const regex = new RegExp(escapeRegExp(trimmedQ), 'i');
        const searchOr = [
            { title: regex },
            { artist: regex },
            { author: regex },
            { director: regex },
            { barcode: regex },
            { 'tracklist.title': regex }
        ];
        if (mongoose.Types.ObjectId.isValid(trimmedQ)) {
            searchOr.push({ _id: trimmedQ });
        }

        const items = await Item.find({
            owner: adminId,
            $or: searchOr
        }).limit(10).select('_id title artist author director kind cover_image format format_type platform media_type').lean();

        res.json(items);
    } catch (err) {
      console.error("[ERR] search collection", err);
      res.status(500).json({ error: "Search failed" });
    }
  },
);

router.get(
  "/api/search-image-universal",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    let { q, type } = req.query;
    q = typeof q === 'string' ? q.trim() : '';
    console.log(`[SEARCH] Query: "${q}" | Type: ${type}`);

    const axiosConfig = {
      headers: { "User-Agent": "DVinylApp/2.0" },
      timeout: 10000,
      httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
    };

    try {
      if (type === "book") {
        const response = await axios.get(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10`,
          axiosConfig,
        );
        const results = (response.data.docs || [])
          .filter((doc) => doc.cover_i)
          .map(
            (doc) => `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
          );

        return res.json(results);
      }

      if (type === "game") {
        try {
          // 1. Get IGDB assets (Covers + Artworks + Screenshots)
          const igdbResults = await igdbRequest(
            "games",
            `search "${q.replace(/"/g, '\\"')}";
                    fields cover.url, artworks.url, screenshots.url;
                    limit 5;`,
          );

          let urls = [];
          igdbResults.forEach((g) => {
            if (g.cover && g.cover.url) urls.push(g.cover.url);
            if (g.artworks) g.artworks.forEach((a) => urls.push(a.url));
            if (g.screenshots) g.screenshots.forEach((s) => urls.push(s.url));
          });

          urls = urls.map((u) => {
            let res = u.replace("t_thumb", "t_cover_big");
            if (res.startsWith("//")) res = "https:" + res;
            return res;
          });

          // TMDB fallback
          const tmdbApiKey = process.env.TMDB_API_KEY;
          if (tmdbApiKey) {
            const tmdbLang = TMDB_LANG_MAP[req.language] || "en-US";
            const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}&language=${tmdbLang}`;
            const tmdbRes = await axios.get(tmdbUrl, axiosConfig);
            const tmdbUrls = (tmdbRes.data.results || [])
              .filter((item) => item.poster_path)
              .map(
                (item) => `https://image.tmdb.org/t/p/w500${item.poster_path}`,
              );
            urls = [...urls, ...tmdbUrls];
          }

          // iTunes software fallback
          const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=software&limit=5`;
          const itunesRes = await axios.get(itunesUrl, axiosConfig);
          const itunesUrls = (itunesRes.data.results || [])
            .filter((item) => item.artworkUrl100)
            .map((item) =>
              item.artworkUrl100.replace("100x100bb", "512x512bb"),
            );
          urls = [...urls, ...itunesUrls];

          return res.json([...new Set(urls)]);
        } catch (err) {
          console.error("[ERR] Game image search failed:", err.message);
          return res.json([]);
        }
      }

      if (type === "movie") {
        const tmdbApiKey = process.env.TMDB_API_KEY;
        if (!tmdbApiKey) {
          console.error("[ERR] TMDB_API_KEY missing");
          return res.status(500).json({ error: "Missing TMDB API Key" });
        }

        const tmdbLang = TMDB_LANG_MAP[req.language] || "en-US";
        const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}&language=${tmdbLang}`;
        const response = await axios.get(tmdbUrl, axiosConfig);

        const results = (response.data.results || [])
          .filter((item) => item.poster_path)
          .map((item) => `https://image.tmdb.org/t/p/w500${item.poster_path}`);

        console.log(`[SEARCH] TMDB found: ${results.length} posters`);
        return res.json(results);
      }

      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=12`;
      const response = await axios.get(itunesUrl, axiosConfig);

      const results = (response.data.results || []).map((item) => {
        return item.artworkUrl100.replace("100x100bb.jpg", "600x600bb.jpg");
      });

      console.log(`[SEARCH] iTunes found: ${results.length}`);
      res.json(results);
    } catch (err) {
      console.error("[ERR] search image universal:", err.message);
      res.status(500).json({ error: "[ERR] connexion error" });
    }
  },
);

router.get(
  "/api/search-discogs-gallery",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      let { q } = req.query;
      q = typeof q === 'string' ? q.trim() : '';
      const axiosConfig = {
        headers: {
          "User-Agent": "DVinylApp/2.0",
          Authorization: `Discogs token=${process.env.DISCOGS_TOKEN || ""}`,
        },
      };

      const searchRes = await axios.get(
        `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=3`,
        axiosConfig,
      );
      const results = searchRes.data.results || [];
      const galleryPromises = results.map(async (item) => {
        try {
          const detail = await axios.get(
            `https://api.discogs.com/releases/${item.id}`,
            axiosConfig,
          );
          return (detail.data.images || []).map((img) => img.resource_url);
        } catch (e) {
          return [];
        }
      });

      const allGalleries = await Promise.all(galleryPromises);

      const finalImages = [...new Set(allGalleries.flat())];

      res.json(finalImages);
    } catch (err) {
      console.error("[ERR] Discogs Global Gallery:", err.message);
      res.status(500).json({ error: "ERROR Discogs search" });
    }
  },
);

router.post(
  "/delete-last-items",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { count, kind } = req.body;
    const n = parseInt(count);

    if (!n || n < 1) return res.status(400).json({ error: "Invalid count" });
    if (!["Book", "Music", "Dvd", "Game"].includes(kind))
      return res.status(400).json({ error: "Invalid kind" });

    try {
      const items = await Item.find({ owner: req.user._id, kind })
        .sort({ added_at: -1, _id: -1 })
        .limit(n)
        .select("_id");

      const ids = items.map((i) => i._id);
      const result = await Item.deleteMany({ _id: { $in: ids } });

      res.json({ deleted: result.deletedCount });
    } catch (err) {
      console.error("[ERR] delete-last-items:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/refresh-all-music-metadata",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { mode = "all" } = req.body;
    const token = process.env.DISCOGS_TOKEN;
    if (!token)
      return res.status(500).json({ error: "Discogs token not configured" });

    try {
      let query = {
        discogs_id: { $exists: true, $ne: null },
      };

      let conditions = [
        { $or: [{ kind: "Music" }, { kind: { $exists: false } }] },
      ];

      if (mode === "missing") {
        conditions.push({
          $or: [
            { genre: { $exists: false } },
            { genre: "" },
            { genre: null },
            { genres: { $exists: false } },
            { genres: { $size: 0 } },
            { styles: { $exists: false } },
            { styles: { $size: 0 } },
            { tracklist: { $exists: false } },
            { tracklist: { $size: 0 } },
          ],
        });
      }

      query.$and = conditions;

      const albums = await Item.find(query).select(
        "_id discogs_id title artist genre genres styles tracklist barcode_locked",
      );
      if (albums.length === 0) return res.json({ success: true, count: 0 });

      res.status(202).json({ success: true, total: albums.length });

      (async () => {
        const io = req.app.get("io");
        let current = 0;
        for (const album of albums) {
          current++;
          let success = false;
          let retries = 0;
          while (!success && retries < 3) {
            try {
              if (io && retries === 0) {
                io.emit("refresh_all_progress", {
                  current,
                  total: albums.length,
                  title: `${album.artist} - ${album.title}`,
                });
              }

              const response = await axios.get(
                `https://api.discogs.com/releases/${album.discogs_id}`,
                {
                  headers: {
                    "User-Agent": "DVinylApp/2.0",
                    Authorization: `Discogs token=${token}`,
                  },
                },
              );

              const {
                genres = [],
                styles = [],
                tracklist = [],
                identifiers = [],
              } = response.data;

              const updateObj = {};
              if (mode === "all" || !album.genres || album.genres.length === 0)
                updateObj.genres = genres;
              if (mode === "all" || !album.styles || album.styles.length === 0)
                updateObj.styles = styles;
              if (
                mode === "all" ||
                !album.tracklist ||
                album.tracklist.length === 0
              )
                updateObj.tracklist = tracklist;

              if (!album.barcode_locked) {
                const barcodeObj = identifiers.find(
                  (id) => id.type === "Barcode",
                );
                if (barcodeObj) {
                  updateObj.barcode = barcodeObj.value.replace(/\s/g, "");
                }
              }

              if (!album.genre || album.genre.trim() === "") {
                updateObj.genre = genres[0] || "";
              }

              await Item.updateOne({ _id: album._id }, { $set: updateObj });

              success = true;
              // Respect Discogs API limit (60 req/min)
              await new Promise((r) => setTimeout(r, 1500));
            } catch (err) {
              retries++;
              console.error(
                `[ERR] Refresh bulk ID ${album.discogs_id} (Attempt ${retries}):`,
                err.message,
              );
              if (err.response && err.response.status === 429) {
                // Wait longer if rate limited
                await new Promise((r) => setTimeout(r, 10000));
              } else {
                if (retries >= 3) {
                  await new Promise((r) => setTimeout(r, 1000));
                } else {
                  await new Promise((r) => setTimeout(r, 2000));
                }
              }
              if (retries >= 3 && err.response && err.response.status === 404) {
                success = true; // Break out if 404
              }
            }
          }
        }
        if (io) io.emit("refresh_all_finished", { count: current });
      })();
    } catch (err) {
      console.error("[ERR] Bulk refresh route:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/refresh-all-books-metadata",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { mode = "all" } = req.body;
    const hardcoverKey = process.env.HARDCOVER_API_KEY;
    if (!hardcoverKey)
      return res
        .status(500)
        .json({ error: "Hardcover API key not configured" });

    try {
      let query = { hardcover_slug: { $exists: true, $ne: null } };
      if (mode === "missing") {
        query.$or = [
          { genre: { $exists: false } },
          { genre: "" },
          { genre: null },
          { genres: { $exists: false } },
          { genres: { $size: 0 } },
          { styles: { $exists: false } },
          { styles: { $size: 0 } },
        ];
      }

      const books = await Book.find(query).select(
        "_id hardcover_slug title author genre genres",
      );
      if (books.length === 0) return res.json({ success: true, count: 0 });

      res.status(202).json({ success: true, total: books.length });

      (async () => {
        const io = req.app.get("io");
        let current = 0;
        for (const book of books) {
          current++;
          try {
            if (io) {
              io.emit("refresh_all_progress", {
                current,
                total: books.length,
                title: `${book.author} - ${book.title}`,
              });
            }

            const graphqlQuery = {
              query: `query bookBySlug($slug: String!) {
                          books(where: { slug: { _eq: $slug } }, limit: 1) {
                            taggings {
                              tag { tag }
                            }
                          }
                        }`,
              variables: { slug: book.hardcover_slug },
            };

            const authHeader = hardcoverKey.startsWith("Bearer ")
              ? hardcoverKey
              : `Bearer ${hardcoverKey}`;
            const response = await axios.post(
              "https://api.hardcover.app/v1/graphql",
              graphqlQuery,
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                },
              },
            );

            if (response.data.errors) {
              console.error(
                `[ERR] Bulk Refresh Book GraphQL Errors (${book.hardcover_slug}):`,
                response.data.errors,
              );
              throw new Error(
                response.data.errors[0]?.message || "GraphQL Error",
              );
            }

            const bookData = response.data?.data?.books?.[0];
            if (bookData) {
              let parsedTags = [];
              if (Array.isArray(bookData.taggings)) {
                parsedTags = bookData.taggings.map((bt) => bt.tag?.tag);
              } else if (Array.isArray(bookData.cached_tags)) {
                parsedTags = bookData.cached_tags;
              } else if (typeof bookData.cached_tags === "string") {
                try {
                  parsedTags = JSON.parse(bookData.cached_tags);
                } catch (e) {
                  parsedTags = bookData.cached_tags
                    .split(",")
                    .map((s) => s.trim());
                }
              }

              const whitelistLower = BOOK_GENRES_WHITELIST.map((g) =>
                g.toLowerCase(),
              );
              const filteredGenres = parsedTags
                .filter(Boolean)
                .filter((tag) => whitelistLower.includes(tag.toLowerCase()))
                .map((tag) => {
                  const index = whitelistLower.indexOf(tag.toLowerCase());
                  return BOOK_GENRES_WHITELIST[index];
                });

              const genres = [...new Set(filteredGenres)];

              const updateObj = {};
              if (mode === "all" || !book.genres || book.genres.length === 0)
                updateObj.genres = genres;
              if (!book.genre || book.genre.trim() === "") {
                updateObj.genre = genres[0] || "";
              }

              await Book.updateOne({ _id: book._id }, { $set: updateObj });
            }

            await new Promise((r) => setTimeout(r, 1000));
          } catch (err) {
            console.error(
              `[ERR] Refresh bulk book ${book.hardcover_slug}:`,
              err.message,
            );
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (io) io.emit("refresh_all_finished", { count: current });
      })();
    } catch (err) {
      console.error("[ERR] Bulk refresh books:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/refresh-all-dvds-metadata",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { mode = "all" } = req.body;
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey)
      return res.status(500).json({ error: "TMDB API key not configured" });

    try {
      let query = { tmdb_id: { $exists: true, $ne: null } };
      if (mode === "missing") {
        query.$or = [
          { genre: { $exists: false } },
          { genre: "" },
          { genre: null },
          { genres: { $exists: false } },
          { genres: { $size: 0 } },
          { styles: { $exists: false } },
          { styles: { $size: 0 } },
        ];
      }

      const dvds = await Dvd.find(query).select(
        "_id tmdb_id title director media_type genre genres",
      );
      if (dvds.length === 0) return res.json({ success: true, count: 0 });

      res.status(202).json({ success: true, total: dvds.length });

      (async () => {
        const io = req.app.get("io");
        let current = 0;
        for (const dvd of dvds) {
          current++;
          try {
            if (io) {
              io.emit("refresh_all_progress", {
                current,
                total: dvds.length,
                title: dvd.title,
              });
            }

            const type = dvd.media_type === "tv" ? "tv" : "movie";
            const tmdbLang = TMDB_LANG_MAP[req.language] || "en-US";
            const response = await axios.get(
              `https://api.themoviedb.org/3/${type}/${dvd.tmdb_id}?api_key=${tmdbKey}&language=${tmdbLang}`,
            );

            if (response.data) {
              const genres = (response.data.genres || []).map((g) => g.name);

              const updateObj = {};
              if (mode === "all" || !dvd.genres || dvd.genres.length === 0)
                updateObj.genres = genres;
              if (!dvd.genre || dvd.genre.trim() === "") {
                updateObj.genre = genres[0] || "";
              }

              await Dvd.updateOne({ _id: dvd._id }, { $set: updateObj });
            }

            await new Promise((r) => setTimeout(r, 500));
          } catch (err) {
            console.error(
              `[ERR] Refresh bulk dvd ${dvd.tmdb_id}:`,
              err.message,
            );
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (io) io.emit("refresh_all_finished", { count: current });
      })();
    } catch (err) {
      console.error("[ERR] Bulk refresh dvds:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/refresh-all-games-metadata",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { mode = "all" } = req.body;
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      return res
        .status(500)
        .json({ error: "IGDB/Twitch credentials not configured" });

    try {
      let query = { igdb_id: { $exists: true, $ne: null } };
      if (mode === "missing") {
        query.$or = [
          { genre: { $exists: false } },
          { genre: "" },
          { genre: null },
          { genres: { $exists: false } },
          { genres: { $size: 0 } },
        ];
      }

      const games = await Game.find(query).select(
        "_id igdb_id title developer genre genres",
      );
      if (games.length === 0) return res.json({ success: true, count: 0 });

      res.status(202).json({ success: true, total: games.length });

      (async () => {
        const io = req.app.get("io");
        let current = 0;
        for (const game of games) {
          current++;
          try {
            if (io) {
              io.emit("refresh_all_progress", {
                current,
                total: games.length,
                title: game.title,
              });
            }

            const results = await igdbRequest(
              "games",
              `where id = ${game.igdb_id};
                        fields genres.name, cover.url, first_release_date;
                        limit 1;`,
            );

            if (results && results.length > 0) {
              const data = results[0];
              const genres = (data.genres || []).map((g) => g.name);

              const updateObj = {};
              if (mode === "all" || !game.genres || game.genres.length === 0)
                updateObj.genres = genres;
              if (!game.genre || game.genre.trim() === "") {
                updateObj.genre = genres[0] || "";
              }

              let cover = "";
              if (data.cover && data.cover.url) {
                cover = data.cover.url.replace("t_thumb", "t_cover_big");
                if (cover.startsWith("//")) cover = "https:" + cover;
                updateObj.cover_image = cover;
              }

              await Game.updateOne({ _id: game._id }, { $set: updateObj });
            }

            // IGDB rate limit: 4 requests/second
            await new Promise((r) => setTimeout(r, 300));
          } catch (err) {
            console.error(
              `[ERR] Refresh bulk game ${game.igdb_id}:`,
              err.message,
            );
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (io) io.emit("refresh_all_finished", { count: current });
      })();
    } catch (err) {
      console.error("[ERR] Bulk refresh games:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
