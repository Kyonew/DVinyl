const express = require("express");
const router = express.Router();
const axios = require("axios");
const Dvd = require("../models/Dvd");
const Item = require("../models/Item");
const User = require("../models/User");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const { TMDB_LANG_MAP } = require("../config/constants");

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function getAdminId() {
  const admin = await User.findOne({ isAdmin: true }).select("_id");
  return admin ? admin._id : null;
}

async function findDuplicateDvd(ownerId, tmdbId, title, director, format) {
  const matchFormat = format || 'dvd';

  if (tmdbId) {
    const query = {
      owner: ownerId,
      in_wishlist: false,
      kind: 'Dvd',
      tmdb_id: parseInt(tmdbId)
    };
    if (matchFormat) {
      query.format = matchFormat;
    } else {
      query.$or = [
        { format: { $exists: false } },
        { format: "" }
      ];
    }
    const item = await Item.findOne(query);
    if (item) return item;
  }

  const matchTitle = (title || '').trim();
  const matchDirector = (director || '').trim();

  const query = {
    owner: ownerId,
    in_wishlist: false,
    kind: 'Dvd',
    title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') },
    director: { $regex: new RegExp(`^${escapeRegExp(matchDirector)}$`, 'i') }
  };

  if (matchFormat) {
    query.format = matchFormat;
  } else {
    query.$or = [
      { format: { $exists: false } },
      { format: "" }
    ];
  }

  return await Item.findOne(query);
}

const formatTMDBItem = (item) => {
  const isTv = item.media_type === "tv";

  return {
    tmdb_id: item.id,
    media_type: item.media_type || "movie",
    title: isTv ? item.name : item.title,
    year: isTv
      ? item.first_air_date
        ? item.first_air_date.substring(0, 4)
        : ""
      : item.release_date
        ? item.release_date.substring(0, 4)
        : "",
    cover_image: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : "",
    description: item.overview || "",
  };
};

router.get("/add-dvd", requireAuth, requireAdmin, (req, res) => {
  res.render("add-dvd", {
    results: null,
    user: res.locals.user,
    currentType: "add-dvd",
  });
});

router.post("/search-dvds", requireAuth, requireAdmin, async (req, res) => {
  let query = req.body.query.trim();
  let searchQuery = query;
  let barcodeScanned = "";

  try {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) throw new Error("TMDB_API_KEY missing");
    const tmdbLang = TMDB_LANG_MAP[req.language] || "en-US";

    const isBarcode = /^\d{12,13}$/.test(query.replace(/[- ]/g, ""));

    if (isBarcode) {
      barcodeScanned = query.replace(/[- ]/g, "");
      try {
        const upcResponse = await axios.get(
          `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcodeScanned}`,
        );
        if (upcResponse.data.items && upcResponse.data.items.length > 0) {
          searchQuery = upcResponse.data.items[0].title;
          searchQuery = searchQuery
            .replace(/DVD|Blu-ray|Blu Ray|Coffret|Edition/gi, "")
            .trim();
        }
      } catch (upcErr) {
        console.error("[ERR] UPC Lookup:", upcErr.message);
      }
    }

    const [page1, page2] = await Promise.all([
      axios.get(
        `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(searchQuery)}&language=${tmdbLang}&page=1`,
      ),
      axios.get(
        `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(searchQuery)}&language=${tmdbLang}&page=2`,
      ),
    ]);

    const allResults = [
      ...(page1.data.results || []),
      ...(page2.data.results || []),
    ];

    const filteredResults = allResults.filter(
      (item) => item.media_type === "movie" || item.media_type === "tv",
    );
    const results = filteredResults.map(formatTMDBItem);

    res.render("add-dvd", {
      results,
      scanned_barcode: barcodeScanned,
      user: res.locals.user,
      currentType: "add-dvd",
    });
  } catch (err) {
    console.error("[ERR] DVD seaarch :", err);
    res.render("add-dvd", {
      results: [],
      scanned_barcode: "",
      error: req.t("errors.api_error"),
      user: res.locals.user,
      currentType: "add-dvd",
    });
  }
});

router.get(
  "/confirm-dvd/:media_type/:tmdb_id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const tmdbId = req.params.tmdb_id;
    const mediaType = req.params.media_type;

    try {
      const tmdbApiKey = process.env.TMDB_API_KEY;
      const tmdbLang = TMDB_LANG_MAP[req.language] || "en-US";
      const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbApiKey}&language=${tmdbLang}&append_to_response=credits`;

      const response = await axios.get(url);
      const data = response.data;

      let director = "Inconnu";
      if (mediaType === "movie" && data.credits && data.credits.crew) {
        const dirObj = data.credits.crew.find(
          (member) => member.job === "Director",
        );
        if (dirObj) director = dirObj.name;
      } else if (
        mediaType === "tv" &&
        data.created_by &&
        data.created_by.length > 0
      ) {
        director = data.created_by.map((c) => c.name).join(", ");
      }

      const studio =
        data.production_companies && data.production_companies.length > 0
          ? data.production_companies[0].name
          : "";

      const dvdData = {
        tmdb_id: data.id,
        media_type: mediaType,
        title: mediaType === "tv" ? data.name : data.title,
        director: director,
        studio: studio,
        year:
          mediaType === "tv"
            ? (data.first_air_date || "").substring(0, 4)
            : (data.release_date || "").substring(0, 4),
        duration:
          mediaType === "tv"
            ? `${data.number_of_seasons} Saison(s)`
            : `${data.runtime || "?"} min`,
        cover_image: data.poster_path
          ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
          : "",
        description: data.overview || "",
        genres: data.genres ? data.genres.map((g) => g.name) : [],
      };

      const adminId = await User.findOne({ isAdmin: true })
        .select("_id")
        .lean();
      const locations = await Item.distinct("location", {
        owner: adminId ? adminId._id : null,
        location: { $ne: "" },
      });
      const genres = await Item.distinct("genre", {
        owner: adminId ? adminId._id : null,
        genre: { $ne: "" },
        kind: "Dvd",
      });

      const existingItems = await Item.find({
        owner: adminId ? adminId._id : null,
        in_wishlist: false,
        kind: 'Dvd',
        $or: [
          { tmdb_id: parseInt(dvdData.tmdb_id) },
          {
            title: { $regex: new RegExp(`^${escapeRegExp(dvdData.title)}$`, 'i') },
            director: { $regex: new RegExp(`^${escapeRegExp(dvdData.director)}$`, 'i') }
          }
        ]
      }).lean();

      res.render("confirm-dvd", {
        dvd: dvdData,
        scanned_barcode: req.query.barcode || "",
        user: res.locals.user,
        locations,
        genres,
        currentType: "dvd",
        existingItems,
      });
    } catch (err) {
      console.error("[ERR] DVD retrieval:", err);
      res.status(500).send(req.t("errors.generic_server_error"));
    }
  },
);

router.post("/save-dvd", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      mongo_id,
      title,
      director,
      studio,
      year,
      duration,
      tmdb_id,
      media_type,
      format,
      zone,
      barcode,
      barcode_locked,
      is_boxset,
      cover_image,
      in_wishlist,
      comments,
      location,
      genre,
      genres,
      styles,
      watchStatus,
      user_rating,
      quantity,
    } = req.body;

    const parsedGenres = Array.isArray(genres)
      ? genres
      : genres
        ? genres
            .split(",")
            .map((g) => g.trim())
            .filter(Boolean)
        : [];
    const parsedStyles = Array.isArray(styles)
      ? styles
      : styles
        ? styles
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const adminId = req.user._id;
    const isWishlist = in_wishlist === "true";
    let dvd;
    let isEdit = false;

    if (mongo_id) {
      dvd = await Item.findById(mongo_id);
      isEdit = true;
    }

    if (!dvd) {
      dvd = await findDuplicateDvd(
        adminId,
        tmdb_id,
        title,
        director,
        format
      );
    }

    if (dvd) {
      const qtyToAdd = parseInt(quantity) || 1;
      const finalQty = isEdit ? qtyToAdd : (dvd.quantity || 1) + qtyToAdd;

      if (isEdit) {
        dvd.title = title;
        dvd.director = director;
        dvd.studio = studio;
        dvd.year = year;
        dvd.duration = duration;
        dvd.format = format;
        dvd.zone = zone;
        dvd.barcode = barcode;
        dvd.barcode_locked = barcode_locked === "on";
        dvd.is_boxset = is_boxset === "true";
        dvd.cover_image = cover_image;
        dvd.in_wishlist = isWishlist;
        dvd.comments = comments || "";
        dvd.location = location || "";
        dvd.genre = genre || (parsedGenres.length > 0 ? parsedGenres[0] : "");
        dvd.genres = parsedGenres;
        dvd.styles = parsedStyles;
        dvd.watchStatus = watchStatus || "to_watch";
        dvd.user_rating = user_rating || 0;
        dvd.quantity = finalQty;
      } else {
        // Duplicate addition: just increment quantity and preserve existing fields.
        dvd.quantity = finalQty;
        if (tmdb_id && !dvd.tmdb_id) {
          dvd.tmdb_id = parseInt(tmdb_id);
        }
      }

      await dvd.save();
    } else {
      await Dvd.create({
        title,
        director,
        studio,
        year,
        duration,
        tmdb_id,
        media_type,
        format,
        zone,
        barcode,
        barcode_locked: barcode_locked === "on",
        is_boxset: is_boxset === "true",
        cover_image,
        kind: "Dvd",
        in_wishlist: isWishlist,
        owner: adminId,
        comments: comments || "",
        location: location || "",
        genre: genre || (parsedGenres.length > 0 ? parsedGenres[0] : ""),
        genres: parsedGenres,
        styles: parsedStyles,
        watchStatus: watchStatus || "to_watch",
        user_rating: user_rating || 0,
        quantity: quantity || 1,
      });
    }

    if (isWishlist) {
      res.redirect("/wishlist");
    } else {
      res.redirect(`/collection?type=dvd`);
    }
  } catch (err) {
    console.error("[ERR] DVD save:", err);
    res.status(500).send(req.t("errors.generic_server_error"));
  }
});

router.get("/dvd/edit/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const dvd = await Item.findById(req.params.id);
    if (!dvd || dvd.kind !== "Dvd") {
      return res.redirect("/collection?type=dvd");
    }

    const adminId = await getAdminId();
    const locations = await Item.distinct("location", {
      owner: adminId,
      location: { $ne: "" },
    });
    const genres = await Item.distinct("genre", {
      owner: adminId,
      genre: { $ne: "" },
      kind: "Dvd",
    });

    res.render("edit-dvd", {
      dvd: dvd.toObject(),
      user: res.locals.user,
      locations,
      genres,
      currentType: "dvd",
    });
  } catch (err) {
    console.error(err);
    res.redirect("/collection?type=dvd");
  }
});

router.get("/dvd/:id", requireAuth, async (req, res) => {
  try {
    const dvd = await Item.findById(req.params.id);
    if (!dvd || dvd.kind !== "Dvd") return res.redirect("/collection?type=dvd");

    res.render("dvd-detail", {
      dvd: dvd.toObject(),
      user: res.locals.user,
      currentType: "dvd",
    });
  } catch (err) {
    res.redirect("/collection?type=dvd");
  }
});

router.delete("/api/dvd/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const dvd = await Item.findOne({
      _id: req.params.id,
      owner: res.locals.user._id,
    });

    if (!dvd) {
      return res
        .status(404)
        .json({ error: "DVD not found or you are not the owner." });
    }

    await Item.deleteOne({ _id: req.params.id });
    res.json({ success: true, redirectUrl: `/collection?type=dvd` });
  } catch (err) {
    console.error(err);
    res.status(500).send(req.t("errors.generic_server_error"));
  }
});

router.post(
  "/api/dvd/:id/refresh-info",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const dvd = await Dvd.findById(req.params.id);
      if (!dvd)
        return res.status(404).json({ success: false, error: "DVD not found" });

      if (!dvd.tmdb_id) {
        return res
          .status(400)
          .json({ success: false, error: "No TMDB ID to refresh" });
      }

      const tmdbApiKey = process.env.TMDB_API_KEY;
      const type = dvd.media_type === "tv" ? "tv" : "movie";
      const tmdbLang = TMDB_LANG_MAP[req.language] || "en-US";
      const response = await axios.get(
        `https://api.themoviedb.org/3/${type}/${dvd.tmdb_id}?api_key=${tmdbApiKey}&language=${tmdbLang}`,
      );

      if (!response.data) {
        return res
          .status(404)
          .json({ success: false, error: "Not found on TMDB API" });
      }

      const formatted = formatTMDBItem(response.data);
      const genres = (response.data.genres || []).map((g) => g.name);

      await Dvd.updateOne(
        { _id: dvd._id },
        {
          $set: {
            cover_image: formatted.cover_image,
            description: formatted.description,
            genres: genres,
            genre: genres[0] || "",
            year: formatted.year,
          },
        },
      );

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

module.exports = router;
