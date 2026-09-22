import { Router } from 'express';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import { registry } from '../../../core/registry';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { resolveMemberRole, roleAtLeast } from '../../../utils/collectionHelpers';
import { applyVisibilityFilter } from '../../../utils/visibilityHelper';
import { toApiItem } from '../../../core/apiSerializers';
import { getExtraFields, toFieldDefinitions } from '../../../core/pluginExtraFields';
import { buildApiItemUpdateData } from '../../../core/apiItemPayload';
import { editStamp } from '../../../core/helpers';
import { ItemImageValidationError } from '../../../core/itemImages';
import { deleteItemsAndContents } from '../../../utils/itemHelpers';

const router = Router();

router.get('/items/:itemId', requireApiAuth, async (req: any, res: any) => {
  const { itemId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const item: any = await Item.findById(itemId).lean();
  if (!item || !item.collection) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const { role } = await resolveMemberRole(req.user, item.collection);
  if (!roleAtLeast(role, 'viewer')) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  // Mirrors core/routes/itemRoutes.ts's own detail route: an item the collection hides
  // from its viewers (settings.visibility) is hidden from direct-by-id access too, not
  // just from the listing - the id is the only thing standing between the two, and a
  // client can guess it just as easily as a share link visitor.
  const settings: any = await Settings.findOne({ collection: item.collection }).lean();
  const visibilityQuery: any = { _id: item._id };
  applyVisibilityFilter(visibilityQuery, role === 'admin', settings);
  const stillVisible = await Item.findOne(visibilityQuery).select('_id').lean();
  if (!stillVisible) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const plugin = registry.getByKind(item.kind);
  if (!plugin) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  res.status(200).json({ item: toApiItem(item, plugin) });
});

router.patch('/items/:itemId', requireApiAuth, async (req: any, res: any) => {
  const { itemId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const existingItem: any = await Item.findById(itemId);
  if (!existingItem || !existingItem.collection) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const { role } = await resolveMemberRole(req.user, existingItem.collection);
  if (!roleAtLeast(role, 'editor')) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const plugin = registry.getByKind(existingItem.kind);
  if (!plugin) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  try {
    const settings: any = await Settings.findOne({ collection: existingItem.collection }).lean();
    const extraFieldDefs = toFieldDefinitions(getExtraFields(settings, plugin.id));
    const updateData = buildApiItemUpdateData(plugin, req.body, extraFieldDefs);

    const saveObj: Record<string, any> = { ...updateData, quantity: parseInt(req.body.quantity, 10) || 1 };
    if (!req.body.added_at) {
      saveObj.added_at = existingItem.added_at || new Date();
    }
    if (saveObj.extra && typeof saveObj.extra === 'object') {
      for (const [key, value] of Object.entries(saveObj.extra)) {
        saveObj[`extra.${key}`] = value;
      }
      delete saveObj.extra;
    }

    const EditModel = mongoose.model(plugin.kind);
    await EditModel.updateOne(
      { _id: existingItem._id },
      { $set: { ...saveObj, ...editStamp(req.user._id) } },
      { strict: false }
    );

    const updated: any = await EditModel.findById(existingItem._id).lean();
    res.status(200).json({ item: toApiItem(updated, plugin) });
  } catch (err: any) {
    if (err instanceof ItemImageValidationError) {
      const tooLarge = err.code === 'too_large';
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        error: tooLarge ? 'Images exceed the size limit' : 'Too many images'
      });
    }
    console.error(`API edit error for item ${itemId}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/items/:itemId', requireApiAuth, async (req: any, res: any) => {
  const { itemId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const item: any = await Item.findById(itemId).lean();
  if (!item || !item.collection) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const { role } = await resolveMemberRole(req.user, item.collection);
  if (!roleAtLeast(role, 'editor')) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  try {
    const deleted = await deleteItemsAndContents([item._id]);
    res.status(200).json({ success: true, deleted });
  } catch (err: any) {
    console.error(`API delete error for item ${itemId}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export = router;
