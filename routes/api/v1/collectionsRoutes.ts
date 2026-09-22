import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import Collection from '../../../models/Collection';
import PriceHistory from '../../../models/PriceHistory';
import User from '../../../models/User';
import { registry } from '../../../core/registry';
import { editStamp, escapeRegExp, isBarcodeQuery, lookupBarcodeTitle, searchWithTitleFallback } from '../../../core/helpers';
import { toApiItem } from '../../../core/apiSerializers';
import { buildFieldSuggestions } from '../../../core/fieldSuggestions';
import { buildApiItemUpdateData } from '../../../core/apiItemPayload';
import { getExtraFields, toFieldDefinitions } from '../../../core/pluginExtraFields';
import { ItemImageValidationError } from '../../../core/itemImages';
import { deleteUnusedManagedItemImages, isJpegBuffer, managedItemImagesForQuery, MAX_ITEM_IMAGE_UPLOAD_BYTES, storeItemImage } from '../../../core/itemImageStorage';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiAdmin, requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { generateShareToken, generateUniqueSlug, listUserCollectionsWithRole } from '../../../utils/collectionHelpers';
import { resolveShelfItems } from '../../../utils/itemHelpers';
import { applyVisibilityFilter, applyEnabledModulesFilter, applyContainedFilter } from '../../../utils/visibilityHelper';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_ITEM_IMAGE_UPLOAD_BYTES }
});

router.use(requireApiAuth);

router.get('/collections', async (req: any, res: any) => {
  const collections = await listUserCollectionsWithRole(req.user);
  res.status(200).json({ collections });
});

router.post('/collections', requireApiAdmin, async (req: any, res: any) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, error: 'name is required' });
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

/**
 * Settings are scoped per collection (models/Settings.ts). Fetched fresh here
 * rather than trusted from res.locals.settings, which middleware/settingsMiddleware.ts
 * only ever populates for the session's active collection - not necessarily the :id
 * this request is about. Mirrors settingsMiddleware's own upsert pattern exactly.
 */
async function getCollectionSettings(collectionId: any) {
  return Settings.findOneAndUpdate(
    { collection: collectionId },
    { $setOnInsert: { collection: collectionId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

const MEMBER_ROLES = ['admin', 'editor', 'viewer'];
const createPassword = (length = 12): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
  let password = '';
  for (let i = 0; i < length; i++) password += chars.charAt(Math.floor(Math.random() * chars.length));
  return password;
};

router.patch('/collections/:id', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const name = String(req.body.name || '').trim();
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
  const role = MEMBER_ROLES.includes(req.body.role) ? req.body.role : 'viewer';
  const collectionId = req.apiCollection._id;

  try {
    if (req.body.identifier) {
      const identifier = String(req.body.identifier).trim();
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

    if (req.body.username && req.body.email) {
      const password = createPassword();
      const hashedPassword = await bcrypt.hash(password, 10);
      // The hash is written in the single create: the User schema has no save hook, so
      // creating with the plaintext and overwriting it would store it in the clear
      // between the two writes.
      const newUser = await User.create({ username: req.body.username, email: req.body.email, password: hashedPassword, lastChange: new Date() });
      await Collection.updateOne({ _id: collectionId }, { $addToSet: { members: { user: newUser._id, role } } });
      await User.updateOne({ _id: newUser._id }, { $set: { lastActiveCollectionId: collectionId } });
      return res.status(201).json({
        member: { userId: String(newUser._id), username: newUser.username, email: newUser.email, role },
        generatedPassword: password
      });
    }

    res.status(400).json({ success: false, error: 'Provide either identifier, or username + email' });
  } catch (err: any) {
    console.error('API member add error:', err.message);
    res.status(500).json({ success: false, error: err.message });
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
  const role = MEMBER_ROLES.includes(req.body.role) ? req.body.role : null;
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
  const label = String(req.body.label || '').trim().slice(0, 60);
  const scope = validateShareScope(req.body.scope);
  const shareLink = { token: generateShareToken(), label, enabled: true, scope };

  await Collection.updateOne({ _id: req.apiCollection._id }, { $push: { shareLinks: shareLink } });
  res.status(201).json({ shareLink: serializeShareLink(shareLink) });
});

router.get('/collections/:id/items', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  const settings: any = await getCollectionSettings(req.apiCollection._id);
  const isAdmin = req.apiCollectionRole === 'admin';
  const enabledPlugins = registry.getEnabled(settings);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 25));

  const query: any = { collection: req.apiCollection._id, in_wishlist: false };
  applyVisibilityFilter(query, isAdmin, settings);
  applyEnabledModulesFilter(query, settings);
  applyContainedFilter(query);

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  if (type && type !== 'all') {
    const plugin = enabledPlugins.find(p => p.id === type);
    if (plugin) {
      if (plugin.matchesLegacyItems) {
        query.$and = [...(query.$and || []), { $or: [{ kind: plugin.kind }, { kind: { $exists: false } }] }];
      } else {
        query.kind = plugin.kind;
      }
    }
  }

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search) {
    const regex = new RegExp(escapeRegExp(search), 'i');
    const searchOr: any[] = [{ title: regex }, { barcode: regex }];
    for (const plugin of enabledPlugins) {
      searchOr.push({ [plugin.creatorField]: regex });
    }
    if (mongoose.Types.ObjectId.isValid(search)) searchOr.push({ _id: search });
    query.$and = [...(query.$and || []), { $or: searchOr }];
  }

  const totalItems = await Item.countDocuments(query);
  const found = await Item.find(query)
    .sort({ added_at: -1 })
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
});

router.post('/collections/:id/items/search', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const { pluginId, query, type, year, country, genre_filter, label_filter } = req.body;
  const plugin = registry.get(pluginId);
  if (!plugin || !plugin.searchProvider) {
    return res.status(404).json({ success: false, error: 'Unknown or non-searchable plugin' });
  }

  const rawQuery = typeof query === 'string' ? query.trim() : '';
  const postedBarcode = String(req.body.scanned_barcode || '');
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
    const runSearch = (q: string) => plugin.searchProvider!.search(q, {
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

    res.status(200).json({ results, query: searchQuery, scannedBarcode: scannedBarcode || undefined });
  } catch (err: any) {
    console.error(`API search error for ${plugin.id}:`, err.message);
    res.status(502).json({ success: false, error: `Search provider error: ${err.message}` });
  }
});

router.get('/collections/:id/items/confirm', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const { pluginId, externalId } = req.query;
  const plugin = registry.get(String(pluginId || ''));
  if (!plugin || !plugin.searchProvider) {
    return res.status(404).json({ success: false, error: 'Unknown or non-searchable plugin' });
  }
  if (!externalId) {
    return res.status(400).json({ success: false, error: 'externalId is required' });
  }

  try {
    const details = await plugin.searchProvider.getDetails(String(externalId), {
      ...req.query,
      language: req.language
    });

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

    res.status(200).json({ item: details, suggestions, duplicates });
  } catch (err: any) {
    console.error(`API details fetch error for ${plugin.id} ID ${externalId}:`, err.message);
    res.status(502).json({ success: false, error: `Search provider error: ${err.message}` });
  }
});

router.post('/collections/:id/items', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const plugin = registry.get(String(req.body.pluginId || ''));
  if (!plugin) {
    return res.status(404).json({ success: false, error: 'Unknown plugin' });
  }

  try {
    const activeCollectionId = req.apiCollection._id;
    const settings: any = await getCollectionSettings(activeCollectionId);
    const extraFieldDefs = toFieldDefinitions(getExtraFields(settings, plugin.id));
    const updateData = buildApiItemUpdateData(plugin, req.body, extraFieldDefs);

    if (typeof plugin.handleCreate === 'function') {
      const handled = await plugin.handleCreate(updateData, {
        body: req.body,
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
      existingItem = await plugin.findDuplicate(activeCollectionId, req.body);
    }

    if (existingItem) {
      const qtyToAdd = parseInt(req.body.quantity, 10) || 1;
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

router.get('/collections/:id/stats', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  const settings: any = await getCollectionSettings(req.apiCollection._id);
  const isAdmin = req.apiCollectionRole === 'admin';

  const query: any = { collection: req.apiCollection._id, in_wishlist: false };
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
});

export = router;
