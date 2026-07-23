import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import User from "../models/User";
import BlockedIP from "../models/blockedIP";
import LoginLog from "../models/LoginLog";
import Settings from "../models/Settings";
import Collection from "../models/Collection";
import { requireAuth, requireAdmin, requireCollectionRole } from "../middleware/authMiddleware";
import { generateUniqueSlug } from "../utils/collectionHelpers";
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

interface CollectionAdminData {
  allGenres: Record<string, string[]>;
  visibilitySettings: any;
  collectionDoc: any;
  members: any[];
}

interface InstanceAdminData {
  users: any[];
  blockedIps: any[];
  logs: any[];
  collections: any[];
  itemsTotal: number;
}

/**
 * Data for the per-collection admin page (/admin): everything scoped to the
 * active collection - genres for the visibility panel, visibility settings,
 * the collection document itself and its members (user info populated).
 */
async function loadCollectionAdminData(activeCollectionId: any): Promise<CollectionAdminData> {
  // Get distinct genres grouped by kind (scoped to the active collection)
  const pipeline = [
    { $match: { collection: activeCollectionId } },
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
    (await Settings.findOne({ collection: activeCollectionId }).populate("visibility.hiddenItems").lean()) || {};

  const collectionDoc = await Collection.findById(activeCollectionId)
    .populate("members.user", "username email img isAdmin lastChange")
    .lean();

  const members = (collectionDoc?.members || []).filter((m: any) => m.user);

  return { allGenres, visibilitySettings, collectionDoc, members };
}

/**
 * Data for the instance admin page (/admin/instance): global users, IPs,
 * login logs and the full collections list (members populated + item counts,
 * to drive the per-collection management modal).
 */
async function loadInstanceAdminData(): Promise<InstanceAdminData> {
  const users = await User.find().sort({ lastChange: -1 });
  const blockedIps = await BlockedIP.find().sort({ createdAt: -1 });
  const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(20);
  const collections: any[] = await Collection.find()
    .sort({ created_at: -1 })
    .populate("members.user", "username email img isAdmin")
    .lean();

  const counts = await Item.aggregate([
    { $group: { _id: "$collection", n: { $sum: 1 } } },
  ]);
  const countByCollection: Record<string, number> = {};
  let itemsTotal = 0;
  for (const c of counts) {
    countByCollection[String(c._id)] = c.n;
    itemsTotal += c.n;
  }
  for (const c of collections) {
    c.itemCount = countByCollection[String(c._id)] || 0;
    // Drop membership rows whose user was deleted outside the app
    c.members = (c.members || []).filter((m: any) => m.user);
  }

  return { users, blockedIps, logs, collections, itemsTotal };
}

// COLLECTION ADMIN PAGE (GET /admin) - gated on the active collection's admin role
router.get("/", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const data = await loadCollectionAdminData(res.locals.activeCollectionId);

    // Read optional message key from query and translate in the view.
    const msgKey = req.query.msg as string | undefined;

    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: msgKey ? req.t(`messages.${msgKey}`) : null,
      newPassword: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(req.t("errors.generic_server_error"));
  }
});

// INSTANCE ADMIN PAGE (GET /admin/instance): global users, all collections, IPs,
// login logs, whole-instance backup. Distinct from GET / above, which manages
// only the active collection and is reachable by a collection's own admins.
router.get("/instance", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const data = await loadInstanceAdminData();
    const msgKey = req.query.msg as string | undefined;

    res.render("admin-instance", {
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

// Add user at the INSTANCE level (POST) - creates a global account with no
// collection membership; collection admins attach members from their own page.
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

    console.log(`[ADMIN] User created: ${username} <${email}> by ${res.locals.user?.email}`);

    const data = await loadInstanceAdminData();

    res.render("admin-instance", {
      ...data,
      user: res.locals.user,
      successMessage: req.t("messages.user_created_success", { name: username }),
      newPassword: password,
      apiKeyStatus: registry.getApiKeyStatus(),
    });
  } catch (err) {
    console.error("[ADMIN] User creation error:", err);
    res.redirect("/admin/instance?msg=user_created");
  }
});

// Create collection (POST) - instance level: only the instance admin creates collections.
router.post("/collections/create", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) {
      return res.redirect("/admin/instance?msg=error_collection_name");
    }

    const slug = await generateUniqueSlug(name);
    await Collection.create({
      name,
      slug,
      createdBy: req.user._id,
      isDefault: false,
      members: [{ user: req.user._id, role: "admin" }],
    });

    res.redirect("/admin/instance?msg=collection_created");
  } catch (err) {
    console.error("Collection creation error:", err);
    res.redirect("/admin/instance?msg=error_collection_name");
  }
});

// Rename collection (POST) - a collection admin renames HIS OWN (active) collection;
// the instance admin can rename any. Slug stays stable (not used for routing).
router.post("/collections/:id/rename", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) {
      return res.redirect("/admin?msg=error_collection_name");
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.redirect("/admin");
    }

    const isOwnActive = String(req.params.id) === String(res.locals.activeCollectionId);
    if (!isOwnActive && !res.locals.user.isAdmin) {
      return res.redirect("/admin");
    }

    await Collection.updateOne({ _id: req.params.id }, { $set: { name } });
    res.redirect(isOwnActive ? "/admin?msg=collection_renamed" : "/admin/instance?msg=collection_renamed");
  } catch (err) {
    console.error("Collection rename error:", err);
    res.redirect("/admin?msg=error_collection_name");
  }
});

// Delete collection (POST) - instance level, destructive cascade: removes the
// collection's items and settings. The default collection cannot be deleted.
router.post("/collections/:id/delete", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.redirect("/admin/instance");
    }
    const target = await Collection.findById(req.params.id);
    if (!target) {
      return res.redirect("/admin/instance");
    }
    if (target.isDefault) {
      return res.redirect("/admin/instance?msg=error_delete_default_collection");
    }

    await Item.deleteMany({ collection: target._id });
    await Settings.deleteMany({ collection: target._id });
    // Users pointing at this collection self-heal to another membership on next request
    await User.updateMany(
      { lastActiveCollectionId: target._id },
      { $set: { lastActiveCollectionId: null } },
    );
    await Collection.deleteOne({ _id: target._id });

    res.redirect("/admin/instance?msg=collection_deleted");
  } catch (err) {
    console.error("Collection delete error:", err);
    res.redirect("/admin/instance");
  }
});

// ============ INSTANCE-LEVEL MEMBER MANAGEMENT (any collection by :id) ============
// The instance admin manages any collection's members straight from /admin/instance.

router.post("/instance/collections/:id/members/add", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const { userId } = req.body;
    const role = ["admin", "editor", "viewer"].includes(req.body.role) ? req.body.role : "viewer";
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.redirect("/admin/instance");
    }

    const target = await User.findById(userId).select("_id lastActiveCollectionId");
    if (!target) return res.redirect("/admin/instance?msg=error_member_not_found");

    const already = await Collection.findOne({ _id: req.params.id, "members.user": userId });
    if (already) return res.redirect("/admin/instance?msg=error_member_exists");

    await Collection.updateOne(
      { _id: req.params.id },
      { $addToSet: { members: { user: userId, role } } },
    );
    // Give homeless users a landing collection right away
    if (!target.lastActiveCollectionId) {
      await User.updateOne({ _id: userId }, { $set: { lastActiveCollectionId: req.params.id } });
    }

    res.redirect("/admin/instance?msg=member_added");
  } catch (err) {
    console.error("Instance member add error:", err);
    res.redirect("/admin/instance?msg=error_member");
  }
});

router.post("/instance/collections/:id/members/role", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const { userId } = req.body;
    const role = ["admin", "editor", "viewer"].includes(req.body.role) ? req.body.role : null;
    if (!role || !mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.redirect("/admin/instance");
    }

    await Collection.updateOne(
      { _id: req.params.id, "members.user": userId },
      { $set: { "members.$.role": role } },
    );
    res.redirect("/admin/instance?msg=member_role_updated");
  } catch (err) {
    console.error("Instance member role error:", err);
    res.redirect("/admin/instance?msg=error_member");
  }
});

router.post("/instance/collections/:id/members/remove", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const { userId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.redirect("/admin/instance");
    }

    await Collection.updateOne(
      { _id: req.params.id },
      { $pull: { members: { user: userId } } },
    );
    await User.updateOne(
      { _id: userId, lastActiveCollectionId: req.params.id },
      { $set: { lastActiveCollectionId: null } },
    );

    res.redirect("/admin/instance?msg=member_removed");
  } catch (err) {
    console.error("Instance member remove error:", err);
    res.redirect("/admin/instance?msg=error_member");
  }
});

// ============ COLLECTION MEMBERS (collection-admin scope) ============

const MEMBER_ROLES = ["admin", "editor", "viewer"];

/** True if the collection keeps at least one 'admin' member besides `excludedUserId`. */
function hasAnotherCollectionAdmin(collectionDoc: any, excludedUserId: any): boolean {
  return (collectionDoc?.members || []).some(
    (m: any) => m.role === "admin" && String(m.user) !== String(excludedUserId),
  );
}

// Create a NEW instance user directly as a member of the active collection.
router.post("/members/create", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const { username, email } = req.body;
    const role = MEMBER_ROLES.includes(req.body.role) ? req.body.role : "viewer";
    const password = createPassword();
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      username,
      email,
      password: password,
      lastChange: new Date(),
    });
    await User.updateOne({ _id: newUser._id }, { $set: { password: hashedPassword } });

    await Collection.updateOne(
      { _id: res.locals.activeCollectionId },
      { $addToSet: { members: { user: newUser._id, role } } },
    );
    await User.updateOne(
      { _id: newUser._id },
      { $set: { lastActiveCollectionId: res.locals.activeCollectionId } },
    );

    const data = await loadCollectionAdminData(res.locals.activeCollectionId);
    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: req.t("messages.user_created_success", { name: username }),
      newPassword: password,
    });
  } catch (err) {
    console.error("Member creation error:", err);
    res.redirect("/admin?msg=error_member");
  }
});

// Invite an EXISTING instance user into the active collection (by email or username).
router.post("/members/invite", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const identifier = (req.body.identifier || "").trim();
    const role = MEMBER_ROLES.includes(req.body.role) ? req.body.role : "viewer";
    if (!identifier) return res.redirect("/admin?msg=error_member_not_found");

    const target: any = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier }],
    });
    if (!target) return res.redirect("/admin?msg=error_member_not_found");

    const already = await Collection.findOne({
      _id: res.locals.activeCollectionId,
      "members.user": target._id,
    });
    if (already) return res.redirect("/admin?msg=error_member_exists");

    await Collection.updateOne(
      { _id: res.locals.activeCollectionId },
      { $addToSet: { members: { user: target._id, role } } },
    );

    res.redirect("/admin?msg=member_added");
  } catch (err) {
    console.error("Member invite error:", err);
    res.redirect("/admin?msg=error_member");
  }
});

// Change a member's role. One cannot change one's OWN role (another admin must),
// and the last collection admin cannot be demoted.
router.post("/members/role", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const { userId } = req.body;
    const role = MEMBER_ROLES.includes(req.body.role) ? req.body.role : null;
    if (!role || !mongoose.Types.ObjectId.isValid(userId)) return res.redirect("/admin");

    if (String(userId) === String(req.user._id)) {
      return res.redirect("/admin?msg=error_self_role");
    }

    const coll = await Collection.findById(res.locals.activeCollectionId);
    const member = (coll?.members || []).find((m: any) => String(m.user) === String(userId));
    if (!member) return res.redirect("/admin?msg=error_member_not_found");

    if (member.role === "admin" && role !== "admin" && !hasAnotherCollectionAdmin(coll, userId)) {
      return res.redirect("/admin?msg=error_last_admin");
    }

    await Collection.updateOne(
      { _id: res.locals.activeCollectionId, "members.user": userId },
      { $set: { "members.$.role": role } },
    );
    res.redirect("/admin?msg=member_role_updated");
  } catch (err) {
    console.error("Member role error:", err);
    res.redirect("/admin?msg=error_member");
  }
});

// Remove a member from the active collection. The last collection admin cannot leave.
router.post("/members/remove", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const { userId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.redirect("/admin");

    const coll = await Collection.findById(res.locals.activeCollectionId);
    const member = (coll?.members || []).find((m: any) => String(m.user) === String(userId));
    if (!member) return res.redirect("/admin?msg=error_member_not_found");

    if (member.role === "admin" && !hasAnotherCollectionAdmin(coll, userId)) {
      return res.redirect("/admin?msg=error_last_admin");
    }

    await Collection.updateOne(
      { _id: res.locals.activeCollectionId },
      { $pull: { members: { user: userId } } },
    );
    // If they were browsing this collection, let the middleware pick another one
    await User.updateOne(
      { _id: userId, lastActiveCollectionId: res.locals.activeCollectionId },
      { $set: { lastActiveCollectionId: null } },
    );

    res.redirect("/admin?msg=member_removed");
  } catch (err) {
    console.error("Member remove error:", err);
    res.redirect("/admin?msg=error_member");
  }
});

// Reset a member's password. Refused when the target is the instance admin OR
// belongs to any other collection: resetting a shared user's password would let
// this collection's admin impersonate them and take over their roles elsewhere.
router.post("/members/reset-password", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const { userId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.redirect("/admin");

    const isMember = await Collection.findOne({
      _id: res.locals.activeCollectionId,
      "members.user": userId,
    });
    const target: any = await User.findById(userId);
    if (!isMember || !target || target.isAdmin) {
      return res.redirect("/admin?msg=error_member_not_found");
    }

    const otherMembership = await Collection.findOne({
      _id: { $ne: res.locals.activeCollectionId },
      "members.user": userId,
    });
    if (otherMembership && !res.locals.user.isAdmin) {
      return res.redirect("/admin?msg=error_shared_member_reset");
    }

    const password = createPassword();
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.updateOne(
      { _id: userId },
      { $set: { password: hashedPassword, lastChange: new Date() } },
    );

    const data = await loadCollectionAdminData(res.locals.activeCollectionId);
    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: req.t("messages.password_reset_success", { name: target.username }),
      newPassword: password,
    });
  } catch (err) {
    console.error("Member reset error:", err);
    res.redirect("/admin?msg=error_member");
  }
});

// ============ INSTANCE USERS ============

// Reset password (POST)
router.post("/reset-password", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const { userId } = req.body;
    const userToUpdate = await User.findById(userId);

    // Instance admins are peers: none may reset another instance admin's
    // password (that would let them hijack the account). Resetting your own is
    // still allowed.
    if (
      userToUpdate &&
      userToUpdate.isAdmin &&
      userToUpdate._id.toString() !== res.locals.user._id.toString()
    ) {
      return res.redirect("/admin/instance?msg=reset_admin_error");
    }

    if (userToUpdate) {
      const password = createPassword();
      const hashedPassword = await bcrypt.hash(password, 10);

      await User.updateOne(
        { _id: userId },
        { $set: { password: hashedPassword, lastChange: new Date() } },
      );

      // Reload data for the view after change.
      const data = await loadInstanceAdminData();

      res.render("admin-instance", {
        ...data,
        user: res.locals.user,
        successMessage: req.t("messages.password_reset_success", {
          name: userToUpdate.username,
        }),
        newPassword: password,
        apiKeyStatus: registry.getApiKeyStatus(),
      });
    } else {
      res.redirect("/admin/instance");
    }
  } catch (err) {
    console.error(err);
    res.redirect("/admin");
  }
});

// Delete user (POST) - instance level; also drops every collection membership.
router.post("/delete-user", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    if (req.body.userId === res.locals.user._id.toString())
      return res.redirect("/admin/instance?msg=delete_self_error");
    // Instance admins are peers: none may delete another instance admin.
    const target = await User.findById(req.body.userId);
    if (target && target.isAdmin)
      return res.redirect("/admin/instance?msg=delete_admin_error");
    await User.findByIdAndDelete(req.body.userId);
    await Collection.updateMany({}, { $pull: { members: { user: req.body.userId } } });
    console.log(`[ADMIN] User deleted: ${req.body.userId} by ${res.locals.user?.email}`);
    res.redirect("/admin/instance?msg=user_deleted");
  } catch (err) {
    console.error("[ADMIN] User deletion error:", err);
    res.redirect("/admin/instance");
  }
});

router.post("/block-ip", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const { ipAddress } = req.body;
    const exists = await BlockedIP.findOne({ ip: ipAddress });
    if (!exists) await BlockedIP.create({ ip: ipAddress });
    console.log(`[ADMIN] IP blocked: ${ipAddress} by ${res.locals.user?.email}${exists ? ' (already blocked)' : ''}`);
    res.redirect("/admin/instance?msg=ip_blocked");
  } catch (err) {
    console.error("[ADMIN] block-ip error:", err);
    res.redirect("/admin/instance");
  }
});

router.post("/unblock-ip", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    await BlockedIP.findByIdAndDelete(req.body.ipId);
    console.log(`[ADMIN] IP unblocked: ${req.body.ipId} by ${res.locals.user?.email}`);
    res.redirect("/admin/instance?msg=ip_unblocked");
  } catch (err) {
    console.error("[ADMIN] unblock-ip error:", err);
    res.redirect("/admin/instance");
  }
});

// Delete the N most recent login logs (instance level, JSON API like delete-last-items).
router.post("/delete-last-logs", requireAuth, requireAdmin, async (req: any, res: any) => {
  const n = parseInt(req.body.count);
  if (!n || n < 1) return res.status(400).json({ error: "Invalid count" });

  try {
    const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(n).select("_id");
    const ids = logs.map((l) => l._id);
    const result = await LoginLog.deleteMany({ _id: { $in: ids } });
    res.json({ deleted: result.deletedCount });
  } catch (err: any) {
    console.error("[ERR] delete-last-logs:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/personnalisation", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
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
  requireCollectionRole("admin"),
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

      await Settings.findOneAndUpdate(
      { collection: res.locals.activeCollectionId },
      { $set: update },
      { upsert: true },
    );

      res.redirect("/admin/personnalisation?msg=saved");
    } catch (err) {
      console.error("[ERR] perso save", err);
      res.status(500).send("[ERR] perso save failed.");
    }
  },
);

router.post("/modules/save", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
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

    await Settings.findOneAndUpdate(
      { collection: res.locals.activeCollectionId },
      { $set: update },
      { upsert: true },
    );

    res.redirect("/admin?msg=saved");
  } catch (err) {
    console.error("[ERR] modules save", err);
    res.status(500).send("[ERR] modules save failed.");
  }
});

router.post("/visibility/save", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const { applyToAdmin, hiddenItems, hiddenGenres, hiddenTypes } = req.body || {};

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

    await Settings.findOneAndUpdate(
      { collection: res.locals.activeCollectionId },
      { $set: update },
      { upsert: true },
    );

    res.redirect("/admin?msg=saved");
  } catch (err) {
    console.error("[ERR] visibility save", err);
    res.status(500).send("[ERR] visibility save failed.");
  }
});

router.get(
  "/api/search-collection",
  requireAuth,
  requireCollectionRole("admin"),
  async (req: any, res: any) => {
    try {
      const { q } = req.query;
      const trimmedQ = typeof q === 'string' ? q.trim() : '';
      if (!trimmedQ) return res.json([]);

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
        collection: res.locals.activeCollectionId,
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
  requireCollectionRole("editor"),
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
  requireCollectionRole("admin"),
  async (req: any, res: any) => {
    const { count, kind } = req.body;
    const n = parseInt(count);

    if (!n || n < 1) return res.status(400).json({ error: "Invalid count" });
    const allowedKinds = registry.getAll().map(p => p.kind);
    if (!allowedKinds.includes(kind))
      return res.status(400).json({ error: "Invalid kind" });

    try {
      const items = await Item.find({ collection: res.locals.activeCollectionId, kind })
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
  requireCollectionRole("admin"),
  async (req: any, res: any) => {
    const { pluginId } = req.params;
    const { mode = "all" } = req.body;
    const plugin = registry.get(pluginId);
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    if (!plugin.refreshItem) return res.status(400).json({ error: "Plugin does not support refresh" });

    try {
      const idField = plugin.externalIdField || '_id';

      let query: any = {
        collection: res.locals.activeCollectionId,
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
