import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import User from "../models/User";
import BlockedIP from "../models/blockedIP";
import LoginLog from "../models/LoginLog";
import Settings from "../models/Settings";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware";
import PRESETS from "../config/themes";
import Item from "../models/Item";

import { registry } from "../core/registry.js";

const router = express.Router();

const createPassword = (length = 12): string => {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};


const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface AdminData {
  users: any[];
  blockedIps: any[];
  logs: any[];
  allGenres: Record<string, string[]>;
  visibilitySettings: any;
}

/**
 * Helper to load the common admin data used by the dashboard view.
 * Centralizing this avoids duplicating queries across handlers.
 */
async function loadAdminData(): Promise<AdminData> {
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

  const allGenres: Record<string, string[]> = {};
  genreGroupsRaw.forEach((group: any) => {
    if (group._id && group.genres && group.genres.length > 0) {
      allGenres[group._id] = group.genres.filter(Boolean).sort();
    }
  });

  const visibilitySettings =
    (await Settings.findOne().populate("visibility.hiddenItems").lean()) || {};

  return { users, blockedIps, logs, allGenres, visibilitySettings };
}

// DASHBOARD (GET)
router.get("/", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const data = await loadAdminData();

    // Read optional message key from query and translate in the view.
    const msgKey = req.query.msg as string | undefined;

    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: msgKey ? req.t(`messages.${msgKey}`) : null,
      newPassword: null,
      apiKeyStatus: registry.getApiKeyStatus(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(req.t("errors.generic_server_error"));
  }
});

// Add user (POST)
router.post("/add-user", requireAuth, requireAdmin, async (req: any, res: any) => {
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
      successMessage: req.t("messages.user_created_success", { name: username }),
      newPassword: password,
    });
  } catch (err) {
    console.error("Creation error:", err);
    res.redirect("/admin?msg=user_created");
  }
});

// Reset password (POST)
router.post("/reset-password", requireAuth, requireAdmin, async (req: any, res: any) => {
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

// Delete user (POST)
router.post("/delete-user", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    if (req.body.userId === res.locals.user._id.toString())
      return res.redirect("/admin?msg=delete_self_error");
    await User.findByIdAndDelete(req.body.userId);
    res.redirect("/admin?msg=user_deleted");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.post("/block-ip", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const { ipAddress } = req.body;
    const exists = await BlockedIP.findOne({ ip: ipAddress });
    if (!exists) await BlockedIP.create({ ip: ipAddress });
    res.redirect("/admin?msg=ip_blocked");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.post("/unblock-ip", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    await BlockedIP.findByIdAndDelete(req.body.ipId);
    res.redirect("/admin?msg=ip_unblocked");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.get("/personnalisation", requireAuth, requireAdmin, async (req: any, res: any) => {
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
  async (req: any, res: any) => {
    try {
      const {
        homePreset,
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

      const validFastAdd = [""].concat(
        registry.getAll().flatMap(p => (p.fastAddOptions || []).map(o => o.value))
      );
      const fastAdd = validFastAdd.includes(req.body.fastAdd)
        ? req.body.fastAdd
        : "";

      const update: Record<string, any> = {
        "theme.home.preset": homePreset,
        navbarShortcuts: shortcuts,
        statsWidgets: stats,
        fastAdd: fastAdd,
      };
      for (const p of registry.getAll()) {
        const preset = req.body[`${p.collectionType}Preset`];
        if (preset) update[`theme.${p.collectionType}.preset`] = preset;
      }

      await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

      res.redirect("/admin/personnalisation?msg=saved");
    } catch (err) {
      console.error("[ERR] perso save", err);
      res.status(500).send("[ERR] perso save failed.");
    }
  },
);

router.post("/modules/save", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const moduleKeys = registry.getAll().map(p => p.collectionType);

    if (!moduleKeys.some(key => req.body[`${key}Active`] === "on")) {
      return res.redirect("/admin?msg=error_no_module");
    }

    const update: Record<string, any> = {};
    for (const key of moduleKeys) {
      update[`modules.${key}`] = req.body[`${key}Active`] === "on";
    }

    // Plugin-scoped settings (⚙ per module): pluginSetting_<pluginId>_<key>
    for (const p of registry.getAll()) {
      for (const opt of p.settings || []) {
        update[`pluginSettings.${p.id}.${opt.key}`] = req.body[`pluginSetting_${p.id}_${opt.key}`] === "on";
      }
    }

    await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

    res.redirect("/admin?msg=saved");
  } catch (err) {
    console.error("[ERR] modules save", err);
    res.status(500).send("[ERR] modules save failed.");
  }
});

router.post("/visibility/save", requireAuth, requireAdmin, async (req: any, res: any) => {
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

router.get(
  "/api/search-collection",
  requireAuth,
  requireAdmin,
  async (req: any, res: any) => {
    try {
      const { q } = req.query;
      const trimmedQ = typeof q === 'string' ? q.trim() : '';
      if (!trimmedQ) return res.json([]);

      const admin = await User.findOne({ isAdmin: true }).select('_id');
      const adminId = admin ? admin._id : null;

      const regex = new RegExp(escapeRegExp(trimmedQ), 'i');
      const searchOr: any[] = [
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
  async (req: any, res: any) => {
    let { q, type } = req.query;
    q = typeof q === 'string' ? q.trim() : '';
    console.log(`[SEARCH] Query: "${q}" | Type: ${type}`);

    try {
      // Each plugin declares its imageSearchProvider; fall back to the legacy plugin (music)
      const plugin = registry.getAll().find(p => p.imageSearchType === type && p.imageSearchProvider)
        || registry.getAll().find(p => p.matchesLegacyItems && p.imageSearchProvider);

      if (!plugin || !plugin.imageSearchProvider) {
        return res.json([]);
      }

      const urls = await plugin.imageSearchProvider.search(q, { language: req.language });
      console.log(`[SEARCH] ${plugin.id} found: ${urls.length} images`);
      res.json(urls);
    } catch (err: any) {
      console.error("[ERR] search image universal:", err.message);
      res.status(500).json({ error: "[ERR] connexion error" });
    }
  },
);

router.post(
  "/delete-last-items",
  requireAuth,
  requireAdmin,
  async (req: any, res: any) => {
    const { count, kind } = req.body;
    const n = parseInt(count);

    if (!n || n < 1) return res.status(400).json({ error: "Invalid count" });
    const allowedKinds = registry.getAll().map(p => p.kind);
    if (!allowedKinds.includes(kind))
      return res.status(400).json({ error: "Invalid kind" });

    try {
      const items = await Item.find({ owner: req.user._id, kind })
        .sort({ added_at: -1, _id: -1 })
        .limit(n)
        .select("_id");

      const ids = items.map((i) => i._id);
      const result = await Item.deleteMany({ _id: { $in: ids } });

      res.json({ deleted: result.deletedCount });
    } catch (err: any) {
      console.error("[ERR] delete-last-items:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/refresh-all/:pluginId",
  requireAuth,
  requireAdmin,
  async (req: any, res: any) => {
    const { pluginId } = req.params;
    const { mode = "all" } = req.body;
    const plugin = registry.get(pluginId);
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    if (!plugin.refreshItem) return res.status(400).json({ error: "Plugin does not support refresh" });

    try {
      const idField = plugin.externalIdField || '_id';

      let query: any = {
        owner: req.user._id,
        [idField]: { $exists: true, $ne: null }
      };

      if (plugin.matchesLegacyItems) {
        query.$and = [{ $or: [{ kind: plugin.kind }, { kind: { $exists: false } }] }];
      } else {
        query.kind = plugin.kind;
      }

      if (mode === "missing") {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { genre: { $exists: false } },
            { genre: "" },
            { genre: null },
            { genres: { $exists: false } },
            { genres: { $size: 0 } },
            { styles: { $exists: false } },
            { styles: { $size: 0 } }
          ]
        });
      }

      const items = await Item.find(query).lean();
      if (items.length === 0) return res.json({ success: true, count: 0 });

      res.status(202).json({ success: true, total: items.length });

      (async () => {
        const io = req.app.get("io");
        let current = 0;
        for (const item of items) {
          current++;
          let success = false;
          let retries = 0;
          while (!success && retries < 3) {
            try {
              if (io && retries === 0) {
                io.emit("refresh_all_progress", {
                  current,
                  total: items.length,
                  title: `${item[plugin.creatorField]} - ${item.title}`,
                });
              }

              const refreshedData = await plugin.refreshItem!(item, req);
              // "missing" mode only backfills genre metadata, never clobber cover/description/
              // publisher/etc that the user may have edited by hand.
              let dataToApply = refreshedData;
              if (mode === "missing") {
                dataToApply = {};
                for (const k of ["genre", "genres", "styles"]) {
                  if (refreshedData[k] !== undefined) dataToApply[k] = refreshedData[k];
                }
              }
              if (Object.keys(dataToApply).length > 0) {
                await Item.updateOne({ _id: item._id }, { $set: dataToApply });
              }

              success = true;
              await new Promise((r) => setTimeout(r, plugin.bulkRefreshDelayMs ?? 500));
            } catch (err: any) {
              retries++;
              console.error(
                `[ERR] Refresh bulk ID for ${plugin.id} (Attempt ${retries}):`,
                err.message,
              );
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        }
        if (io) io.emit("refresh_all_finished", { count: current });
      })();

    } catch (err: any) {
      console.error("[ERR] Bulk refresh route:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  }
);

export = router;
