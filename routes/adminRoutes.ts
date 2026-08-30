import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import QRCode from "qrcode";
import User from "../models/User";
import BlockedIP from "../models/blockedIP";
import LoginLog from "../models/LoginLog";
import Settings from "../models/Settings";
import Collection from "../models/Collection";
import { requireAuth, requireAdmin, requireCollectionRole } from "../middleware/authMiddleware";
import { generateUniqueSlug, generateShareToken } from "../utils/collectionHelpers";
import { BASE_URL } from "../config/constants";
import { getInstanceSettings, saveInstanceSettings, InstanceSettingsData } from "../utils/instanceSettings";
import PRESETS from "../config/themes";
import Item from "../models/Item";

import { registry } from "../core/registry.js";
import { CARD_ASPECT_RATIOS } from "../core/customPlugin";
import { PermanentRefreshError, syncStamp } from "../core/helpers";
import { deleteItemsAndContents } from "../utils/itemHelpers";
import { AI_PROVIDERS } from "../core/ai/providers";
import { getAiConfig, getStoredAiSettings, saveAiSettings } from "../core/ai/instance";
import { isAiConfigured, resolveTestConfig } from "../core/ai/config";
import { keyHint } from "../core/ai/secret";
import { aiChat, AiError } from "../core/ai/client";

// PROD=true is the operator's own declaration that the instance is served over HTTPS
// (see docs/getting-started.md). Trust that over req.protocol, which depends on the
// reverse proxy correctly forwarding X-Forwarded-Proto - a single misconfigured proxy
// hop otherwise silently downgrades every generated share link/QR code to http.
function getPublicProtocol(req: any): string {
  return process.env.PROD === "true" ? "https" : req.protocol;
}

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
  instanceSettings: InstanceSettingsData;
}

/**
 * Data for the per-collection admin page (/admin): everything scoped to the
 * active collection - genres for the visibility panel, visibility settings,
 * the collection document itself and its members (user info populated).
 */
async function loadCollectionAdminData(activeCollectionId: any): Promise<CollectionAdminData> {
  // Get distinct genres grouped by kind (scoped to the active collection)
  const pipeline = [
    // Contained items carry their holder's genres, so counting them here would just
    // repeat what the holder already contributed.
    { $match: { collection: activeCollectionId, parent: { $exists: false } } },
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

  // Counted like the grid shows: a show with five seasons is one line and counts as one,
  // so the number here always matches what a member can count on screen.
  const counts = await Item.aggregate([
    { $match: { parent: { $exists: false } } },
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

  return {
    users,
    blockedIps,
    logs,
    collections,
    itemsTotal,
    instanceSettings: await getInstanceSettings(),
  };
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
      // Share links must show a full, absolute URL (scheme + host) - a bare
      // baseUrl-relative path is not something you can scan/paste elsewhere.
      siteOrigin: `${getPublicProtocol(req)}://${req.get("host")}`,
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

// Instance-wide settings (POST) - currently the member self-service collection toggle
// and its per-user quota. Stored in the InstanceSettings singleton, not in the
// per-collection Settings document.
router.post("/instance/settings", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    // Unchecked checkboxes are simply absent from the body
    const allow = req.body.allowMemberCollectionCreation === "on"
      || req.body.allowMemberCollectionCreation === "true";

    // Clamp to the schema's bounds: the number input is client-side only, a crafted
    // POST could otherwise store 0 (nobody can create) or a negative quota.
    const parsed = parseInt(req.body.maxCollectionsPerUser, 10);
    const max = Math.min(100, Math.max(1, isNaN(parsed) ? 1 : parsed));

    await saveInstanceSettings({
      allowMemberCollectionCreation: allow,
      maxCollectionsPerUser: max,
    });

    console.log(`[ADMIN] Instance settings updated by ${res.locals.user?.email}: member collection creation ${allow ? "enabled" : "disabled"} (max ${max}/user)`);
    res.redirect("/admin/instance?msg=saved");
  } catch (err) {
    console.error("[ADMIN] Instance settings error:", err);
    res.redirect("/admin/instance?msg=generic_error");
  }
});

// GET /admin/instance/ai -> current AI settings, never the key itself
router.get("/instance/ai", requireAuth, requireAdmin, async (_req: any, res: any) => {
  const config = await getAiConfig();
  res.json({
    enabled: config.enabled,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    visionModel: config.visionModel,
    hasKey: Boolean(config.apiKey),
    keyHint: keyHint(config.apiKey),
    // The panel greys its inputs out when the environment is in charge, so nobody edits
    // a value that an AI_* variable is going to override on the next read.
    fromEnv: config.fromEnv,
    configured: isAiConfigured(config),
    providers: AI_PROVIDERS.map(p => ({
      id: p.id, label: p.label, baseUrl: p.baseUrl,
      defaultModel: p.defaultModel, defaultVisionModel: p.defaultVisionModel, docsUrl: p.docsUrl
    }))
  });
});

// POST /admin/instance/ai -> save the AI settings
router.post("/instance/ai", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    await saveAiSettings({
      enabled: req.body?.enabled === true || req.body?.enabled === 'true',
      provider: String(req.body?.provider || 'openrouter'),
      baseUrl: String(req.body?.baseUrl || ''),
      model: String(req.body?.model || ''),
      visionModel: String(req.body?.visionModel || ''),
      apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : ''
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] AI settings save:', err.message);
    res.status(500).json({ success: false, error: req.t('ai.err_save') });
  }
});

// POST /admin/instance/ai/test -> one real round-trip, so a bad key is found here.
// Tests the panel's current fields, not the saved config, so a key can be tried before
// committing to Save; any field left blank falls back to what's actually stored.
router.post("/instance/ai/test", requireAuth, requireAdmin, async (req: any, res: any) => {
  const stored = await getStoredAiSettings();
  const config = resolveTestConfig({
    provider: String(req.body?.provider || ''),
    baseUrl: String(req.body?.baseUrl || ''),
    model: String(req.body?.model || ''),
    visionModel: String(req.body?.visionModel || ''),
    apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  }, stored);
  if (!isAiConfigured(config)) {
    return res.status(400).json({ success: false, error: req.t('ai.err_not_configured') });
  }
  try {
    const result = await aiChat(
      config,
      [{ role: 'user', content: 'Reply with the single word: ready' }],
      { maxTokens: 16, timeoutMs: 15000 }
    );
    res.json({ success: true, model: result.model, reply: result.text.trim().slice(0, 100) });
  } catch (err: any) {
    const status = err instanceof AiError && err.status ? err.status : 502;
    res.status(status).json({ success: false, error: err.message });
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
      // A name is a value, not markup: the view escapes it on the way out, and letting
      // i18next escape it first would print the entities instead of the apostrophe.
      successMessage: req.t("messages.password_reset_success", {
        name: target.username,
        interpolation: { escapeValue: false },
      }),
      newPassword: password,
    });
  } catch (err) {
    console.error("Member reset error:", err);
    res.redirect("/admin?msg=error_member");
  }
});

// ============ COLLECTION SHARING (collection-admin scope) ============
// Public, account-free read-only browsing via routes/shareRoutes.ts. A collection can
// have several independent links at once (e.g. one scoped to Vinyls, one to CDs) -
// each with its own token, so disabling/regenerating/deleting one never touches
// the others.

/**
 * Builds a shareLinks[].scope array from a create/edit submission. Checking no type
 * boxes at all means "whole collection" - there is no separate on/off toggle for
 * scope itself. A format checked without its type box (e.g. JS failed to auto-check
 * it - see the checkbox script in views/admin.ejs) still counts: the type is implied
 * by having any format selected under it, so a submission is never silently dropped.
 */
function parseShareScope(body: any): { pluginId: string; formats: string[] }[] {
  const rawTypes = body.scopeTypes;
  const checkedTypes: string[] = Array.isArray(rawTypes) ? rawTypes : rawTypes ? [rawTypes] : [];

  const impliedTypes = Object.keys(body)
    .filter((k) => k.startsWith("scopeFormats_"))
    .filter((k) => (Array.isArray(body[k]) ? body[k].length > 0 : !!body[k]))
    .map((k) => k.slice("scopeFormats_".length));

  const selectedTypes = [...new Set([...checkedTypes, ...impliedTypes])];

  return selectedTypes
    .map((id: string) => {
      const plugin = registry.get(id);
      if (!plugin) return null;

      const rawFormats = body[`scopeFormats_${id}`];
      const submitted: string[] = Array.isArray(rawFormats) ? rawFormats : rawFormats ? [rawFormats] : [];
      const validFormats = new Set((plugin.formats || []).map((f: any) => f.value));
      const formats = submitted.filter((f: string) => validFormats.has(f));

      return { pluginId: id, formats };
    })
    .filter((entry): entry is { pluginId: string; formats: string[] } => !!entry);
}

// Create a new share link with the submitted scope (and optional label).
router.post("/share/create", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const label = String(req.body.label || "").trim().slice(0, 60);
    const scope = parseShareScope(req.body);

    await Collection.updateOne(
      { _id: res.locals.activeCollectionId },
      { $push: { shareLinks: { token: generateShareToken(), label, enabled: true, scope } } },
    );
    res.redirect("/admin?msg=share_link_created");
  } catch (err) {
    console.error("Share create error:", err);
    res.redirect("/admin?msg=error_share");
  }
});

// Flip one link's enabled state (disabling keeps its token - re-enabling reuses the
// same link/QR code instead of forcing a reprint).
router.post("/share/:token/toggle", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const coll: any = await Collection.findOne(
      { _id: res.locals.activeCollectionId, "shareLinks.token": req.params.token },
      { "shareLinks.$": 1 },
    );
    const link = coll?.shareLinks?.[0];
    if (!link) return res.redirect("/admin?msg=error_share");

    await Collection.updateOne(
      { _id: res.locals.activeCollectionId, "shareLinks.token": req.params.token },
      { $set: { "shareLinks.$.enabled": !link.enabled } },
    );
    res.redirect(`/admin?msg=${link.enabled ? "share_disabled" : "share_enabled"}`);
  } catch (err) {
    console.error("Share toggle error:", err);
    res.redirect("/admin?msg=error_share");
  }
});

// Update an existing link's scope and/or label in place.
router.post("/share/:token/scope", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const label = String(req.body.label || "").trim().slice(0, 60);
    const scope = parseShareScope(req.body);

    const result = await Collection.updateOne(
      { _id: res.locals.activeCollectionId, "shareLinks.token": req.params.token },
      { $set: { "shareLinks.$.scope": scope, "shareLinks.$.label": label } },
    );
    if (result.matchedCount === 0) return res.redirect("/admin?msg=error_share");
    res.redirect("/admin?msg=share_scope_updated");
  } catch (err) {
    console.error("Share scope error:", err);
    res.redirect("/admin?msg=error_share");
  }
});

// Rotate a link's token - instantly invalidates whatever URL/QR code is already out
// there, without touching this collection's other links.
router.post("/share/:token/regenerate", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    const result = await Collection.updateOne(
      { _id: res.locals.activeCollectionId, "shareLinks.token": req.params.token },
      { $set: { "shareLinks.$.token": generateShareToken(), "shareLinks.$.enabled": true } },
    );
    if (result.matchedCount === 0) return res.redirect("/admin?msg=error_share");
    res.redirect("/admin?msg=share_regenerated");
  } catch (err) {
    console.error("Share regenerate error:", err);
    res.redirect("/admin?msg=error_share");
  }
});

// Remove a link entirely.
router.post("/share/:token/delete", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    // The token is named in the filter as well as in the $pull, the way the routes above
    // do it: a token belonging to another collection would otherwise pull nothing while
    // still reporting a success, since the schema's timestamps count every update as a
    // modification whether or not anything came out of the array.
    const result = await Collection.updateOne(
      { _id: res.locals.activeCollectionId, "shareLinks.token": req.params.token },
      { $pull: { shareLinks: { token: req.params.token } } },
    );
    if (result.matchedCount === 0) return res.redirect("/admin?msg=error_share");
    res.redirect("/admin?msg=share_link_deleted");
  } catch (err) {
    console.error("Share delete error:", err);
    res.redirect("/admin?msg=error_share");
  }
});

// Server-rendered QR PNG so a link's token never has to be handed to a
// third-party QR-image API - it stays entirely within this instance.
router.get("/share/:token/qr.png", requireAuth, requireCollectionRole("admin"), async (req: any, res: any) => {
  try {
    // $elemMatch, because a collection holds several links: named separately, the two
    // conditions can be met by two different ones, and the QR of a link someone just
    // disabled would keep being served as long as any other link is still on.
    const coll = await Collection.findOne(
      {
        _id: res.locals.activeCollectionId,
        shareLinks: { $elemMatch: { token: req.params.token, enabled: true } },
      },
      { _id: 1 },
    );
    if (!coll) return res.status(404).send(req.t("errors.not_found"));

    const url = `${getPublicProtocol(req)}://${req.get("host")}${BASE_URL}/share/${req.params.token}`;
    const png = await QRCode.toBuffer(url, { type: "png", width: 320, margin: 1 });
    res.set("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
    console.error("Share QR error:", err);
    res.status(500).send(req.t("errors.generic_server_error"));
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
          interpolation: { escapeValue: false },
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
        aspectRatioClass,
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

      // Ends up in a class attribute on every card, so only the offered frames pass.
      const cardAspect = (CARD_ASPECT_RATIOS as readonly string[]).includes(aspectRatioClass)
        ? aspectRatioClass
        : "aspect-square";

      const update: Record<string, any> = {
        "theme.home.preset": homePreset,
        aspectRatioClass: cardAspect,
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

    update.mergeDuplicates = req.body.mergeDuplicates === "on";

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
      // Counted the way the grid counts: "the last 3 items" means the last 3 lines someone
      // can see, and a show leaves with its seasons rather than counting as several.
      const items = await Item.find({
        collection: res.locals.activeCollectionId,
        kind,
        parent: { $exists: false }
      })
        .sort({ added_at: -1, _id: -1 })
        .limit(n)
        .select("_id");

      const deleted = await deleteItemsAndContents(items.map((i) => i._id));

      res.json({ deleted });
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
              // Written even when the provider changed nothing, so the date says when the
              // item was last checked rather than when it last happened to differ.
              await Item.updateOne({ _id: item._id }, { $set: { ...dataToApply, ...syncStamp() } });

              success = true;
              await new Promise((r) => setTimeout(r, plugin.bulkRefreshDelayMs ?? 500));
            } catch (err: any) {
              retries++;
              console.error(
                `[ERR] Refresh bulk ID for ${plugin.id} (Attempt ${retries}):`,
                err.message,
              );
              // Nothing about this item can change between attempts: retrying only
              // stretches the run by 6 seconds per item for the same failure.
              if (err instanceof PermanentRefreshError) break;
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
