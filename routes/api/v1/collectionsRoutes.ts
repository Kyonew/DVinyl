import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import Collection from '../../../models/Collection';
import PriceHistory from '../../../models/PriceHistory';
import User from '../../../models/User';
import { registry } from '../../../core/registry';
import { hasSearch, resolveSource, searchableSources } from '../../../core/sources';
import { editStamp, escapeRegExp, getPublicProtocol, isBarcodeQuery, lookupBarcodeTitle, searchWithTitleFallback } from '../../../core/helpers';
import { toApiItem } from '../../../core/apiSerializers';
import { resolveItemSort } from '../../../core/itemSort';
import { shelfNames, resolveShelfLocation } from '../../../core/shelfStore';
import { buildFieldSuggestions } from '../../../core/fieldSuggestions';
import { buildApiItemUpdateData } from '../../../core/apiItemPayload';
import { getExtraFields, toFieldDefinitions } from '../../../core/pluginExtraFields';
import { ItemImageValidationError } from '../../../core/itemImages';
import { deleteUnusedManagedItemImages, isJpegBuffer, managedItemImagesForQuery, MAX_ITEM_IMAGE_UPLOAD_BYTES, storeItemImage } from '../../../core/itemImageStorage';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiAdmin, requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { generateShareToken, generateUniqueSlug, listUserCollectionsWithRole } from '../../../utils/collectionHelpers';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import { resolveShelfItems } from '../../../utils/itemHelpers';
import { checkCollectionCreation } from '../../../utils/instanceSettings';
import { applyVisibilityFilter, applyEnabledModulesFilter, applyContainedFilter } from '../../../utils/visibilityHelper';
import { BASE_URL } from '../../../config/constants';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_ITEM_IMAGE_UPLOAD_BYTES }
});

/**
 * The plugin's own extra search fields, as a plain options record.
 *
 * A plugin can declare `searchFormFields` the core knows nothing about — games adds the
 * ScreenScraper `platform`, which narrows a search to one system. Only declared names are
 * read, and only as non-empty strings, so a client cannot smuggle arbitrary option keys
 * into the provider call.
 */
function pluginSearchFields(plugin: any, body: Record<string, any>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const name of plugin.searchFormFields || []) {
    const value = body?.[name];
    if (typeof value === 'string' && value.trim()) fields[name] = value.trim();
  }
  return fields;
}

router.use(requireApiAuth);

router.get('/collections', async (req: any, res: any) => {
  const collections = await listUserCollectionsWithRole(req.user);
  res.status(200).json({ collections });
});

router.post('/collections', async (req: any, res: any) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }

  const verdict = await checkCollectionCreation(req.user);
  if (verdict !== 'ok') {
    return res.status(403).json({ success: false, error: verdict === 'quota' ? 'Collection limit reached' : 'Creating collections is not allowed' });
  }

  try {
    const slug = await generateUniqueSlug(name);
    const created = await Collection.create({
      name,
      slug,
      createdBy: req.user._id,
      isDefault: false,
      members: [{ user: req.user._id, role: 'admin' }]
    });
    res.status(201).json({ collection: { id: String(created._id), name: created.name, role: 'admin' } });
  } catch (err: any) {
    console.error('API collection create error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const MEMBER_ROLES = ['admin', 'editor', 'viewer'];
const createPassword = (length = 12): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
  let password = '';
  for (let i = 0; i < length; i++) password += chars.charAt(Math.floor(Math.random() * chars.length));
  return password;
};

router.patch('/collections/:id', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  try {
    await Collection.updateOne({ _id: req.apiCollection._id }, { $set: { name } });
    res.status(200).json({ collection: { id: String(req.apiCollection._id), name } });
  } catch (err: any) {
    console.error('API collection rename error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/collections/:id', requireApiAdmin, async (req: any, res: any) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ success: false, error: 'Collection not found' });
  }
  const target = await Collection.findById(req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, error: 'Collection not found' });
  }
  if (target.isDefault) {
    return res.status(400).json({ success: false, error: 'The default collection cannot be deleted' });
  }

  try {
    const itemImages = await managedItemImagesForQuery({ collection: target._id });
    await Item.deleteMany({ collection: target._id });
    await Settings.deleteMany({ collection: target._id });
    await PriceHistory.deleteMany({ collection: target._id });
    await User.updateMany({ lastActiveCollectionId: target._id }, { $set: { lastActiveCollectionId: null } });
    await Collection.deleteOne({ _id: target._id });
    try {
      await deleteUnusedManagedItemImages(itemImages);
    } catch (cleanupError) {
      console.warn('[ITEM IMAGE] Collection cleanup failed:', cleanupError);
    }
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API collection delete error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/collections/:id/members', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const coll: any = await Collection.findById(req.apiCollection._id)
    .populate('members.user', 'username email img isAdmin')
    .lean();
  const members = (coll?.members || [])
    .filter((m: any) => m.user)
    .map((m: any) => ({
      userId: String(m.user._id),
      username: m.user.username,
      email: m.user.email,
      img: m.user.img,
      role: m.role
    }));
  res.status(200).json({ members });
});

router.post('/collections/:id/members', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const body = req.body || {};
  const role = MEMBER_ROLES.includes(body.role) ? body.role : 'viewer';
  const collectionId = req.apiCollection._id;

  try {
    if (body.identifier) {
      const identifier = String(body.identifier).trim();
      const target: any = await User.findOne({
        $or: [{ email: identifier.toLowerCase() }, { username: identifier }]
      });
      if (!target) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const already = await Collection.findOne({ _id: collectionId, 'members.user': target._id });
      if (already) {
        return res.status(409).json({ success: false, error: 'User is already a member' });
      }
      await Collection.updateOne({ _id: collectionId }, { $addToSet: { members: { user: target._id, role } } });
      return res.status(201).json({
        member: { userId: String(target._id), username: target.username, email: target.email, role }
      });
    }

    if (body.username && body.email) {
      const password = createPassword();
      const hashedPassword = await bcrypt.hash(password, 10);
      // The hash is written in the single create: the User schema has no save hook, so
      // creating with the plaintext and overwriting it would store it in the clear
      // between the two writes.
      const newUser = await User.create({ username: body.username, email: body.email, password: hashedPassword, lastChange: new Date() });
      await Collection.updateOne({ _id: collectionId }, { $addToSet: { members: { user: newUser._id, role } } });
      await User.updateOne({ _id: newUser._id }, { $set: { lastActiveCollectionId: collectionId } });
      return res.status(201).json({
        member: { userId: String(newUser._id), username: newUser.username, email: newUser.email, role },
        generatedPassword: password
      });
    }

    res.status(400).json({ success: false, error: 'Provide either identifier, or username + email' });
  } catch (err: any) {
    console.error('API member add error:', err);
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, error: 'A user with that username or email already exists' });
    }
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: 'Invalid username or email' });
    }
    res.status(500).json({ success: false, error: 'Failed to add member' });
  }
});

/** True if the collection keeps at least one 'admin' member besides `excludedUserId`. */
function hasAnotherCollectionAdmin(collectionDoc: any, excludedUserId: any): boolean {
  return (collectionDoc?.members || []).some(
    (m: any) => m.role === 'admin' && String(m.user) !== String(excludedUserId)
  );
}

router.patch('/collections/:id/members/:userId', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const { userId } = req.params;
  const body = req.body || {};
  const role = MEMBER_ROLES.includes(body.role) ? body.role : null;
  if (!role || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid role or userId' });
  }
  if (String(userId) === String(req.user._id)) {
    return res.status(400).json({ success: false, error: 'Cannot change your own role' });
  }

  const coll: any = await Collection.findById(req.apiCollection._id);
  const member = (coll?.members || []).find((m: any) => String(m.user) === String(userId));
  if (!member) {
    return res.status(404).json({ success: false, error: 'Member not found' });
  }
  if (member.role === 'admin' && role !== 'admin' && !hasAnotherCollectionAdmin(coll, userId)) {
    return res.status(400).json({ success: false, error: 'Cannot demote the last admin' });
  }

  await Collection.updateOne(
    { _id: req.apiCollection._id, 'members.user': userId },
    { $set: { 'members.$.role': role } }
  );
  res.status(200).json({ success: true });
});

router.delete('/collections/:id/members/:userId', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid userId' });
  }

  const coll: any = await Collection.findById(req.apiCollection._id);
  const member = (coll?.members || []).find((m: any) => String(m.user) === String(userId));
  if (!member) {
    return res.status(404).json({ success: false, error: 'Member not found' });
  }
  if (member.role === 'admin' && !hasAnotherCollectionAdmin(coll, userId)) {
    return res.status(400).json({ success: false, error: 'Cannot remove the last admin' });
  }

  await Collection.updateOne({ _id: req.apiCollection._id }, { $pull: { members: { user: userId } } });
  await User.updateOne(
    { _id: userId, lastActiveCollectionId: req.apiCollection._id },
    { $set: { lastActiveCollectionId: null } }
  );
  res.status(200).json({ success: true });
});

router.post('/collections/:id/members/:userId/reset-password', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid userId' });
  }

  const isMember = await Collection.findOne({ _id: req.apiCollection._id, 'members.user': userId });
  const target: any = await User.findById(userId);
  if (!isMember || !target || target.isAdmin) {
    return res.status(404).json({ success: false, error: 'Member not found' });
  }

  const otherMembership = await Collection.findOne({
    _id: { $ne: req.apiCollection._id },
    'members.user': userId
  });
  if (otherMembership && !req.user.isAdmin) {
    return res.status(403).json({ success: false, error: 'This member belongs to another collection too — only an instance admin can reset their password' });
  }

  const password = createPassword();
  const hashedPassword = await bcrypt.hash(password, 10);
  await User.updateOne({ _id: userId }, { $set: { password: hashedPassword, lastChange: new Date() } });
  res.status(200).json({ generatedPassword: password });
});

/** Validates a JSON share scope against the registered plugins' real formats. */
function validateShareScope(raw: any): { pluginId: string; formats: string[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => {
      const plugin = registry.get(String(entry?.pluginId || ''));
      if (!plugin) return null;
      const validFormats = new Set((plugin.formats || []).map((f: any) => f.value));
      const formats = Array.isArray(entry.formats) ? entry.formats.filter((f: string) => validFormats.has(f)) : [];
      return { pluginId: plugin.id, formats };
    })
    .filter((e): e is { pluginId: string; formats: string[] } => !!e);
}

/** The stored share link carries a Mongoose-injected _id on each scope entry; the API
 *  shape is { pluginId, formats } only (matching what a client sends back). */
function serializeShareLink(link: any) {
  return {
    token: link?.token,
    label: link?.label || '',
    enabled: link?.enabled !== false,
    scope: (link?.scope || []).map((s: any) => ({ pluginId: s.pluginId, formats: s.formats || [] }))
  };
}

router.get('/collections/:id/share-links', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const coll: any = await Collection.findById(req.apiCollection._id).select('shareLinks').lean();
  res.status(200).json({ shareLinks: (coll?.shareLinks || []).map(serializeShareLink) });
});

router.post('/collections/:id/share-links', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const body = req.body || {};
  const label = String(body.label || '').trim().slice(0, 60);
  const scope = validateShareScope(body.scope);
  const shareLink = { token: generateShareToken(), label, enabled: true, scope };

  await Collection.updateOne({ _id: req.apiCollection._id }, { $push: { shareLinks: shareLink } });
  res.status(201).json({ shareLink: serializeShareLink(shareLink) });
});

router.patch('/collections/:id/share-links/:token', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const { token } = req.params;
  const body = req.body || {};
  const set: Record<string, any> = {};
  if (typeof body.enabled === 'boolean') set['shareLinks.$.enabled'] = body.enabled;
  if (typeof body.label === 'string') set['shareLinks.$.label'] = body.label.trim().slice(0, 60);
  if (body.scope !== undefined) set['shareLinks.$.scope'] = validateShareScope(body.scope);

  if (Object.keys(set).length === 0) {
    return res.status(400).json({ success: false, error: 'Nothing to update' });
  }

  const result = await Collection.updateOne(
    { _id: req.apiCollection._id, 'shareLinks.token': token },
    { $set: set }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ success: false, error: 'Share link not found' });
  }

  const coll: any = await Collection.findOne(
    { _id: req.apiCollection._id, 'shareLinks.token': token },
    { 'shareLinks.$': 1 }
  ).lean();
  res.status(200).json({ shareLink: serializeShareLink(coll.shareLinks[0]) });
});

router.post('/collections/:id/share-links/:token/regenerate', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const newToken = generateShareToken();
  const result = await Collection.updateOne(
    { _id: req.apiCollection._id, 'shareLinks.token': req.params.token },
    { $set: { 'shareLinks.$.token': newToken, 'shareLinks.$.enabled': true } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ success: false, error: 'Share link not found' });
  }
  const coll: any = await Collection.findOne(
    { _id: req.apiCollection._id, 'shareLinks.token': newToken },
    { 'shareLinks.$': 1 }
  ).lean();
  res.status(200).json({ shareLink: serializeShareLink(coll.shareLinks[0]) });
});

router.delete('/collections/:id/share-links/:token', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const result = await Collection.updateOne(
    { _id: req.apiCollection._id, 'shareLinks.token': req.params.token },
    { $pull: { shareLinks: { token: req.params.token } } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ success: false, error: 'Share link not found' });
  }
  res.status(200).json({ success: true });
});

router.get('/collections/:id/share-links/:token/qr.png', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const coll = await Collection.findOne(
    { _id: req.apiCollection._id, shareLinks: { $elemMatch: { token: req.params.token, enabled: true } } },
    { _id: 1 }
  );
  if (!coll) {
    return res.status(404).json({ success: false, error: 'Share link not found or disabled' });
  }

  const url = `${getPublicProtocol(req)}://${req.get('host')}${BASE_URL}/share/${req.params.token}`;
  const png = await QRCode.toBuffer(url, { type: 'png', width: 320, margin: 1 });
  res.set('Content-Type', 'image/png');
  res.send(png);
});

/**
 * A listing with no `sort` comes back newest-first, exactly as it always has. Held as a
 * `Record<string, 1 | -1>` so it can share the `.sort()` call with the resolved values.
 */
const DEFAULT_ITEM_SORT: Record<string, 1 | -1> = { added_at: -1 };

/** `?genre=a,b` style parameters as a trimmed, non-empty list; anything else is empty. */
function commaList(raw: any): string[] {
  return typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
}

const likeAny = (values: string[]) => values.map(v => new RegExp(escapeRegExp(v), 'i'));
const exactAny = (values: string[]) => values.map(v => new RegExp(`^${escapeRegExp(v)}$`, 'i'));

/** The plugin a listing's `type` names, or undefined for `all`/empty/an unknown id. */
function selectedPluginFor(enabledPlugins: any[], type: string): any {
  return type && type !== 'all' ? enabledPlugins.find(p => p.id === type) : undefined;
}

/**
 * Narrows a listing query to one plugin's kind. A plugin that also claims the kind-less
 * items of a pre-plugins database needs an `$or`, which cannot sit on `query.kind`, so it
 * goes through `$and` instead.
 */
function applyTypeScope(query: any, selectedPlugin: any): void {
  if (!selectedPlugin) return;
  if (selectedPlugin.matchesLegacyItems) {
    query.$and = [...(query.$and || []), { $or: [{ kind: selectedPlugin.kind }, { kind: { $exists: false } }] }];
  } else {
    query.kind = selectedPlugin.kind;
  }
}

/**
 * The collection page's content filters - format, decade, genre, style, platform and
 * artist - as the conditions the listing ANDs together. Mirrors
 * core/routes/collectionRoute.ts's buildShelfView: a comma list ORs within one field
 * (case-insensitively), the fields AND across, and a blank value contributes nothing so a
 * client may send an unset filter. `artist` spans every enabled plugin's creator field and
 * its declared secondary creator fields.
 */
function contentFilterConditions(req: any, enabledPlugins: any[]): any[] {
  const conditions: any[] = [];

  const format = typeof req.query.format === 'string' ? req.query.format.trim() : '';
  if (format && format !== 'all') {
    const pattern = new RegExp(`^${escapeRegExp(format)}$`, 'i');
    conditions.push({ $or: [{ media_type: pattern }, { format: pattern }] });
  }

  const decades = commaList(req.query.decade).map(d => parseInt(d, 10)).filter(d => !isNaN(d));
  if (decades.length > 0) {
    const years: RegExp[] = [];
    for (const start of decades) {
      for (let y = start; y < start + 10; y++) years.push(new RegExp(`^${y}$`));
    }
    conditions.push({ year: { $in: years } });
  }

  const genres = commaList(req.query.genre);
  if (genres.length > 0) {
    conditions.push({
      $or: [{ genre: { $in: likeAny(genres) } }, { genres: { $in: likeAny(genres) } }]
    });
  }

  const styles = commaList(req.query.style);
  if (styles.length > 0) conditions.push({ styles: { $in: likeAny(styles) } });

  const platforms = commaList(req.query.platform);
  if (platforms.length > 0) conditions.push({ platform: { $in: exactAny(platforms) } });

  const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
  if (artist) {
    const regex = new RegExp(escapeRegExp(artist), 'i');
    const fields = new Set<string>();
    for (const plugin of enabledPlugins) {
      fields.add(plugin.creatorField);
      for (const field of plugin.creatorSearchFields || []) fields.add(field);
    }
    conditions.push({ $or: Array.from(fields).map(field => ({ [field]: regex })) });
  }

  return conditions;
}

/**
 * The collection and the wishlist are the same listing over two halves of the same
 * shelf, so `/collections/:id/items` and `/collections/:id/wishlist` share this and
 * differ only on `inWishlist` - mirroring core/routes/collectionRoute.ts's buildShelfView.
 */
async function listShelfItems(req: any, res: any, inWishlist: boolean) {
  const settings: any = await getCollectionSettings(req.apiCollection._id);
  const isAdmin = req.apiCollectionRole === 'admin';
  const enabledPlugins = registry.getEnabled(settings);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 25));

  const query: any = { collection: req.apiCollection._id, in_wishlist: inWishlist };
  applyVisibilityFilter(query, isAdmin, settings);
  applyEnabledModulesFilter(query, settings);
  applyContainedFilter(query);

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const selectedPlugin = selectedPluginFor(enabledPlugins, type);
  applyTypeScope(query, selectedPlugin);

  // Two buckets, mirroring the page: `criteria` is what the user asked to narrow by and is
  // what `filterMode=hide` inverts; the `query` fields set above (visibility, modules, the
  // selected type) define which items the listing is about at all, so inverting those would
  // widen it to other types instead of narrowing it.
  const criteria: any[] = [];

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search) {
    const regex = new RegExp(escapeRegExp(search), 'i');
    const searchOr: any[] = [{ title: regex }, { barcode: regex }];
    for (const plugin of enabledPlugins) {
      searchOr.push({ [plugin.creatorField]: regex });
    }
    if (mongoose.Types.ObjectId.isValid(search)) searchOr.push({ _id: search });
    criteria.push({ $or: searchOr });
  }

  // A shelf page asks two different questions: what is in this compartment (exact name,
  // the shelf view's rule — "Salon" must not draw "Étagère du salon"), and what is in the
  // reserve at all. Both are meaningless on a wishlist, which holds nothing anywhere.
  if (!inWishlist) {
    const location = typeof req.query.location === 'string' ? req.query.location.trim() : '';
    const unshelved = req.query.unshelved === 'true' || req.query.unshelved === '1';
    if (location && unshelved) {
      return res.status(400).json({ success: false, error: 'location and unshelved cannot be combined' });
    }
    if (location) {
      criteria.push({ location });
    } else if (unshelved) {
      // $nin matches a missing field too, so an item that never had a location is reserve.
      criteria.push({ location: { $nin: await shelfNames(req.apiCollection._id) } });
    }
  }

  criteria.push(...contentFilterConditions(req, enabledPlugins));

  if (criteria.length > 0) {
    const applied = req.query.filterMode === 'hide' ? [{ $nor: [{ $and: criteria }] }] : criteria;
    query.$and = [...(query.$and || []), ...applied];
  }

  // Strict where the page is lenient: an omitted sort is the newest-first default, but a
  // value the current type has no option for is a client mistake worth a 400 (rather than
  // the page's silent fallback, which a caller cannot tell apart from success). A repeated
  // `?sort=a&sort=b` arrives as an array, which is not a value we accept either.
  const rawSort = req.query.sort;
  if (rawSort !== undefined && typeof rawSort !== 'string') {
    return res.status(400).json({ success: false, error: 'unknown sort' });
  }
  const sortParam = rawSort || '';
  const itemSort = resolveItemSort(sortParam, selectedPlugin);
  if (sortParam && !itemSort) {
    return res.status(400).json({ success: false, error: 'unknown sort' });
  }

  const totalItems = await Item.countDocuments(query);
  const found = await Item.find(query)
    .sort(itemSort || DEFAULT_ITEM_SORT)
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  // resolveShelfItems reads res.locals.isCollectionAdmin/res.locals.settings - set them
  // explicitly for THIS collection rather than trusting whatever the global
  // collectionMiddleware/settingsMiddleware chain set for the session's active one.
  res.locals.isCollectionAdmin = isAdmin;
  res.locals.settings = settings;
  const resolved = await resolveShelfItems(found, res);

  const items = resolved
    .map((item: any) => {
      const plugin = registry.getByKind(item.kind);
      return plugin ? toApiItem(item, plugin) : null;
    })
    .filter(Boolean);

  res.status(200).json({
    items,
    page,
    limit,
    totalItems,
    totalPages: Math.ceil(totalItems / limit) || 1
  });
}

/**
 * The values a client can offer in the genre/style/platform pickers. Scoped to exactly the
 * items the matching listing can return - visibility, enabled modules, contained items, the
 * owned/wishlist split and the selected `type` - so a returned value always corresponds to
 * something the caller can list. The web page's picker is looser (it reads every item of the
 * collection); this stays tied to the listing on purpose, even though it costs a few values.
 */
async function listValues(req: any, res: any, inWishlist: boolean) {
  const settings: any = await getCollectionSettings(req.apiCollection._id);
  const isAdmin = req.apiCollectionRole === 'admin';
  const enabledPlugins = registry.getEnabled(settings);

  const query: any = { collection: req.apiCollection._id, in_wishlist: inWishlist };
  applyVisibilityFilter(query, isAdmin, settings);
  applyEnabledModulesFilter(query, settings);
  applyContainedFilter(query);

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  applyTypeScope(query, selectedPluginFor(enabledPlugins, type));

  const genreLists = await Promise.all([
    Item.distinct('genres', { ...query, genres: { $nin: ['', null] } }),
    Item.distinct('genre', { ...query, genre: { $nin: ['', null] } })
  ]);
  const genres = [...new Set(genreLists.flat())].filter(Boolean).sort();
  const styles = (await Item.distinct('styles', { ...query, styles: { $nin: ['', null] } })).sort();
  // 'other' is the games plugin's "no known platform"; it is not a pickable value.
  const platforms = (await Item.distinct('platform', { ...query, platform: { $nin: ['', null, 'other'] } })).sort();

  res.status(200).json({ genres, styles, platforms });
}

router.get('/collections/:id/items', requireApiCollectionRole('viewer'), (req: any, res: any) => listShelfItems(req, res, false));

router.get('/collections/:id/wishlist', requireApiCollectionRole('viewer'), (req: any, res: any) => listShelfItems(req, res, true));

router.get('/collections/:id/values', requireApiCollectionRole('viewer'), (req: any, res: any) => listValues(req, res, false));

router.get('/collections/:id/wishlist/values', requireApiCollectionRole('viewer'), (req: any, res: any) => listValues(req, res, true));

router.post('/collections/:id/items/search', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const body = req.body || {};
  const { pluginId, query, type, year, country, genre_filter, label_filter } = body;
  const plugin = registry.get(pluginId);
  if (!plugin || !hasSearch(plugin)) {
    return res.status(404).json({ success: false, error: 'Unknown or non-searchable plugin' });
  }

  const rawQuery = typeof query === 'string' ? query.trim() : '';
  const postedBarcode = String(body.scanned_barcode || '');
  let scannedBarcode = isBarcodeQuery(postedBarcode) ? postedBarcode.replace(/[- ]/g, '') : '';
  let searchQuery = rawQuery;
  let resolvedTitle = '';

  try {
    if (plugin.supportsBarcodeSearch && isBarcodeQuery(rawQuery)) {
      const { barcode, title } = await lookupBarcodeTitle(rawQuery, plugin.barcodeNoiseTerms);
      scannedBarcode = barcode;
      if (!title) {
        return res.status(200).json({ results: [], query: rawQuery, scannedBarcode: barcode, error: 'barcode_not_found' });
      }
      searchQuery = title;
      resolvedTitle = title;
    }

    const settings = await getCollectionSettings(req.apiCollection._id);
    // Which database to ask. An unknown or dropped id falls back to the plugin's first
    // configured source, the same rule the web add page follows.
    const source = resolveSource(plugin, body.source, settings);
    if (!source) {
      return res.status(404).json({ success: false, error: 'No source is configured for this plugin' });
    }

    const runSearch = (q: string) => source.search(q, {
      // The plugin's own search form may add fields the core does not know about (games'
      // ScreenScraper platform). Read only names the plugin declares, strings only, so a
      // client cannot smuggle arbitrary option keys into the provider call.
      ...pluginSearchFields(plugin, req.body || {}),
      type: type || plugin.id,
      year, country, genre_filter, label_filter,
      language: req.language,
      pluginSettings: settings?.pluginSettings?.[plugin.id] || {}
    });

    let results;
    if (resolvedTitle) {
      const attempt = await searchWithTitleFallback(resolvedTitle, runSearch);
      results = attempt.results;
      searchQuery = attempt.query;
    } else {
      results = await runSearch(searchQuery);
    }

    res.status(200).json({
      results,
      query: searchQuery,
      source: source.id,
      sources: searchableSources(plugin, settings).map((s: any) => ({ id: s.id, name: s.name })),
      scannedBarcode: scannedBarcode || undefined
    });
  } catch (err: any) {
    console.error(`API search error for ${plugin.id}:`, err.message);
    res.status(502).json({ success: false, error: `Search provider error: ${err.message}` });
  }
});

router.get('/collections/:id/items/confirm', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const { pluginId, externalId } = req.query;
  const plugin = registry.get(String(pluginId || ''));
  if (!plugin || !hasSearch(plugin)) {
    return res.status(404).json({ success: false, error: 'Unknown or non-searchable plugin' });
  }
  if (!externalId) {
    return res.status(400).json({ success: false, error: 'externalId is required' });
  }

  try {
    const settings = await getCollectionSettings(req.apiCollection._id);
    // The id and the source travel together: an id handed out by one source is meaningless
    // to another, and an unknown one falls back to the plugin's default rather than failing.
    const source = resolveSource(plugin, req.query.source as string | undefined, settings);
    if (!source) {
      return res.status(404).json({ success: false, error: 'No source is configured for this plugin' });
    }

    const details = await source.getDetails(String(externalId), {
      ...req.query,
      language: req.language
    });

    // Where this item is about to come from, handed back so the client posts the pair to
    // the create route and the item stays traceable to the database it was filled in from.
    details.source = source.id;
    details.source_id = String(externalId);

    if (details.creator !== undefined && details[plugin.creatorField] === undefined) {
      details[plugin.creatorField] = details.creator;
    }
    if (req.query.barcode) {
      details.barcode = String(req.query.barcode);
    }

    const collectionId = req.apiCollection._id;
    const suggestions = await buildFieldSuggestions(plugin, collectionId, details);

    let duplicates: any[];
    if (plugin.findPotentialDuplicates) {
      duplicates = await plugin.findPotentialDuplicates(collectionId, details);
    } else {
      const exact = await plugin.findDuplicate(collectionId, details);
      duplicates = exact ? [exact] : [];
    }

    res.status(200).json({ item: details, source: source.id, suggestions, duplicates });
  } catch (err: any) {
    console.error(`API details fetch error for ${plugin.id} ID ${externalId}:`, err.message);
    res.status(502).json({ success: false, error: `Search provider error: ${err.message}` });
  }
});

router.post('/collections/:id/items', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const body = req.body || {};
  const plugin = registry.get(String(body.pluginId || ''));
  if (!plugin) {
    return res.status(404).json({ success: false, error: 'Unknown plugin' });
  }

  try {
    const activeCollectionId = req.apiCollection._id;
    const settings: any = await getCollectionSettings(activeCollectionId);
    const extraFieldDefs = toFieldDefinitions(getExtraFields(settings, plugin.id));
    const updateData = buildApiItemUpdateData(plugin, body, extraFieldDefs);

    // Where an item is kept is the shelf store's to decide, exactly as the web save does:
    // it creates the compartment for a name the collection has never seen, and rewrites a
    // variant spelling onto the collection's own. Bypass it and the duplicates the boot
    // migration merged come straight back.
    updateData.location = await resolveShelfLocation(activeCollectionId, updateData.location);

    // Which database this save came from, handed back by the confirm route. Not a plugin
    // schema path (every item carries the pair), and kept only when the client posts both:
    // a manual add posts neither and must not blank a reference an earlier lookup wrote.
    if (body.source && body.source_id) {
      updateData.source = String(body.source);
      updateData.source_id = String(body.source_id);
    }

    if (typeof plugin.handleCreate === 'function') {
      const handled = await plugin.handleCreate(updateData, {
        body: body,
        ownerId: req.user._id,
        collectionId: activeCollectionId,
        language: req.language
      });
      if (handled) {
        return res.status(200).json({ success: true, handled: true });
      }
    }

    let existingItem: any = null;
    if (settings?.mergeDuplicates !== false) {
      existingItem = await plugin.findDuplicate(activeCollectionId, body);
    }

    if (existingItem) {
      const qtyToAdd = parseInt(body.quantity, 10) || 1;
      const saveObj: Record<string, any> = { quantity: (existingItem.quantity || 1) + qtyToAdd };
      const idField = plugin.externalIdField;
      const backfillKeys = new Set<string>(['barcode', ...(plugin.backfillFields || [])]);
      if (idField) backfillKeys.add(idField);
      for (const key of backfillKeys) {
        const incoming = updateData[key];
        const existingEmpty = existingItem[key] === undefined || existingItem[key] === null || existingItem[key] === '';
        if (incoming !== undefined && incoming !== null && incoming !== '' && existingEmpty) {
          saveObj[key] = (key === idField && /^\d+$/.test(String(incoming))) ? parseInt(String(incoming), 10) : incoming;
        }
      }
      // An item added before sources existed carries no pair; fill it from this save so it
      // stays traceable to the database the client just looked it up in.
      if (updateData.source && !existingItem.source) saveObj.source = updateData.source;
      if (updateData.source_id && !existingItem.source_id) saveObj.source_id = updateData.source_id;

      const EditModel = mongoose.model(plugin.kind);
      await EditModel.updateOne(
        { _id: existingItem._id },
        { $set: { ...saveObj, ...editStamp(req.user._id) } },
        { strict: false }
      );
      const merged: any = await EditModel.findById(existingItem._id).lean();
      return res.status(200).json({ item: toApiItem(merged, plugin), merged: true });
    }

    const Model = mongoose.model(plugin.kind);
    const created = await Model.create({
      ...updateData,
      owner: req.user._id,
      collection: activeCollectionId
    });
    res.status(201).json({ item: toApiItem(created.toObject(), plugin) });
  } catch (err: any) {
    if (err instanceof ItemImageValidationError) {
      const tooLarge = err.code === 'too_large';
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        error: tooLarge ? 'Images exceed the size limit' : 'Too many images'
      });
    }
    console.error(`API create error for ${plugin.id}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/collections/:id/item-images', requireApiCollectionRole('editor'), (req: any, res: any) => {
  upload.single('image')(req, res, async (uploadError: any) => {
    if (uploadError) {
      const tooLarge = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        error: tooLarge ? 'Image too large' : 'Invalid upload'
      });
    }
    if (!req.file || req.file.mimetype !== 'image/jpeg' || !isJpegBuffer(req.file.buffer)) {
      return res.status(400).json({ success: false, error: 'Only JPEG images are accepted' });
    }
    try {
      const url = await storeItemImage(req.file.buffer);
      res.status(201).json({ success: true, url });
    } catch (err: any) {
      console.error('[API ITEM IMAGE] Upload failed:', err);
      res.status(500).json({ success: false, error: 'Upload failed' });
    }
  });
});

/** Shared by `/stats` and `/wishlist/stats`; the two differ only on `inWishlist`. */
async function shelfStats(req: any, res: any, inWishlist: boolean) {
  const settings: any = await getCollectionSettings(req.apiCollection._id);
  const isAdmin = req.apiCollectionRole === 'admin';

  const query: any = { collection: req.apiCollection._id, in_wishlist: inWishlist };
  applyVisibilityFilter(query, isAdmin, settings);
  applyEnabledModulesFilter(query, settings);
  applyContainedFilter(query);

  const allItems = await Item.find(query).lean();
  const stats: any = { total: allItems.reduce((acc: number, i: any) => acc + (i.quantity || 1), 0) };

  for (const plugin of registry.getEnabled(settings)) {
    const pluginItems = allItems.filter((i: any) => i.kind === plugin.kind);
    Object.assign(stats, plugin.getStats(pluginItems));
  }

  res.status(200).json({ stats });
}

router.get('/collections/:id/stats', requireApiCollectionRole('viewer'), (req: any, res: any) => shelfStats(req, res, false));

router.get('/collections/:id/wishlist/stats', requireApiCollectionRole('viewer'), (req: any, res: any) => shelfStats(req, res, true));

export = router;
