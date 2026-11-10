/**
 * Giving one field the same value on every item selected on the collection page
 * (core/bulkEdit.ts).
 */
import express from 'express';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { shelfFilter } from '../../utils/visibilityHelper';
import { db } from '../db';
import { and, eq, isIn } from '../db/query';
import { idOf, isId } from '../db/ids';
import { editStamp } from '../helpers';
import { trackOwnerEdits } from '../keptFields';
import { PluginDefinition } from '../types';
import {
  BulkValueError, MAX_BULK_EDIT_SELECTION, TagsMode, bulkValueFor, sharedBulkFields, storedPath, tagsFor
} from '../bulkEdit';

const router = express.Router();
const editor = [requireAuth, requireCollectionRole('editor')];

/**
 * The selected items the person may reach on the collection page, each with its plugin
 * as this collection shows it (with the fields its admin added). An item whose type is
 * gone is left out.
 */
async function loadSelection(req: any, res: any): Promise<{ items: { item: any; plugin: PluginDefinition }[]; asked: number } | null> {
  const raw = req.body?.ids;
  const ids = Array.from(new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isId)));
  if (ids.length === 0 || ids.length > MAX_BULK_EDIT_SELECTION || !res.locals.activeCollectionId) return null;
  const found = await db.items.find(and(isIn('_id', ids), shelfFilter({
    collectionId: res.locals.activeCollectionId,
    inWishlist: false,
    isAdmin: res.locals.isCollectionAdmin,
    settings: res.locals.settings
  })), { defaults: true });
  const plugins: PluginDefinition[] = res.locals.registry.getAll();
  const items = found
    .map((item: any) => ({
      item,
      // An item from before kinds existed belongs to the plugin that claims those.
      plugin: plugins.find(p => (item.kind ? p.kind === item.kind : p.matchesLegacyItems))
    }))
    .filter((entry: any) => !!entry.plugin) as { item: any; plugin: PluginDefinition }[];
  return { items, asked: ids.length };
}

function pluginsOf(items: { plugin: PluginDefinition }[]): PluginDefinition[] {
  return [...new Map(items.map(({ plugin }) => [plugin.id, plugin])).values()];
}

// The fields the whole selection can be given a value for, for the dialog to offer.
router.post('/api/collection/bulk-fields', ...editor, async (req: any, res: any) => {
  try {
    const selection = await loadSelection(req, res);
    if (!selection || selection.items.length === 0) {
      return res.status(400).json({ success: false, error: req.t('errors.not_found') });
    }
    const label = (text: string) => req.t(text, { defaultValue: text });
    const fields = sharedBulkFields(pluginsOf(selection.items)).map(field => ({
      name: field.name,
      label: label(field.label),
      type: field.type,
      required: field.required === true,
      options: (field.options || []).map(o => ({ value: String(o.value), label: label(o.label) }))
    }));
    res.json({ success: true, fields });
  } catch (err: any) {
    console.error('Bulk fields error:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

router.post('/api/collection/edit-selected', ...editor, async (req: any, res: any) => {
  try {
    const selection = await loadSelection(req, res);
    if (!selection || selection.items.length === 0) {
      return res.status(400).json({ success: false, error: req.t('errors.not_found') });
    }
    const field = sharedBulkFields(pluginsOf(selection.items)).find(f => f.name === req.body?.field);
    if (!field) return res.status(400).json({ success: false, error: req.t('collection.bulk_edit_no_field') });

    let value: any;
    try {
      value = bulkValueFor(field, req.body?.value);
    } catch (err) {
      if (err instanceof BulkValueError) {
        return res.status(400).json({
          success: false,
          error: req.t(err.code === 'required' ? 'collection.bulk_edit_required' : 'collection.bulk_edit_invalid')
        });
      }
      throw err;
    }
    const mode: TagsMode = ['add', 'remove', 'replace'].includes(req.body?.mode) ? req.body.mode : 'add';
    const path = storedPath(field);
    let updated = 0;

    for (const { item, plugin } of selection.items) {
      const id = eq('_id', idOf(item._id));
      const current = field.extraField ? item.extra?.[field.name] : item[field.name];
      const next = field.type === 'tags' ? tagsFor(current, value, mode) : value;
      const set: Record<string, any> = { ...editStamp(req.user._id) };
      const unset: string[] = [];
      if (next === null) unset.push(path); else set[path] = next;
      // The single genre older screens read follows the list, as the edit form does.
      if (field.name === 'genres' && !field.extraField) set.genre = next && next.length > 0 ? next[0] : '';

      await db.items.updateOne(id, { set, unset }, { kind: plugin.kind, allowUndeclared: true });

      // Set by hand, so it outlives the next refresh like an edit-form change does.
      const after = await db.items.findOne(id, { defaults: true });
      const tracked = after && trackOwnerEdits(item, after, [], [plugin.externalIdField].filter(Boolean) as string[]);
      if (tracked) await db.items.updateOne(id, tracked, { kind: plugin.kind, allowUndeclared: true });
      updated++;
    }

    res.json({ success: true, updated, failed: selection.asked - updated });
  } catch (err: any) {
    console.error('Bulk edit error:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

export default router;
