import Item from '../models/Item';
import Settings from '../models/Settings';
import CustomPlugin from '../models/CustomPlugin';
import { registry } from '../core/registry';
import { ExtraFieldConfig, ExtraFieldMap, reservedNamesFor } from '../core/pluginExtraFields';
import { FIELD_NAME_RE } from '../core/customPluginStore';
import {
  EXTRA_FIELD_KEY_VERSION,
  isManagedExtraFieldKey,
  migratedExtraFieldKey
} from '../core/extraFieldIdentity';

export interface ExtraFieldIdentityMigrationSummary {
  fields: number;
  values: number;
  references: number;
  skipped: number;
}

interface FieldRename {
  from: string;
  to: string;
}

interface LegacyValueCleanup extends FieldRename {
  kind: string;
}

/** Rewrites the only persisted UI references to extra-field technical names. */
export function rewriteExtraFieldReferences(
  customization: any,
  pluginId: string,
  renames: FieldRename[]
): { customization: any; changed: number } {
  const source = customization && typeof customization === 'object' ? customization : {};
  const plugin = source[pluginId];
  if (!plugin || typeof plugin !== 'object' || renames.length === 0) {
    return { customization: source, changed: 0 };
  }

  const byOldName = new Map<string, string>();
  for (const rename of renames) {
    // A valid Settings document cannot contain duplicate field names. If a damaged
    // backup does, keep the first deterministic match rather than changing one stored
    // reference twice and pretending the ambiguity was resolved.
    if (!byOldName.has(rename.from)) byOldName.set(rename.from, rename.to);
  }

  let changed = 0;
  const nextPlugin = { ...plugin };
  if (Array.isArray(plugin.cardFields)) {
    nextPlugin.cardFields = plugin.cardFields.map((name: any) => {
      const replacement = typeof name === 'string' ? byOldName.get(name) : undefined;
      if (replacement) changed += 1;
      return replacement || name;
    });
  }
  if (typeof plugin.cornerField === 'string') {
    const replacement = byOldName.get(plugin.cornerField);
    if (replacement) {
      nextPlugin.cornerField = replacement;
      changed += 1;
    }
  }

  if (changed === 0) return { customization: source, changed: 0 };
  return {
    customization: { ...source, [pluginId]: nextPlugin },
    changed
  };
}

async function candidateHasConflictingValue(
  collection: any,
  kind: string,
  oldName: string,
  candidate: string
): Promise<boolean> {
  const conflict = await Item.collection.findOne(
    {
      collection,
      kind,
      [`extra.${candidate}`]: { $exists: true },
      $or: [
        { [`extra.${oldName}`]: { $exists: false } },
        { $expr: { $ne: [`$extra.${oldName}`, `$extra.${candidate}`] } }
      ]
    },
    { projection: { _id: 1 } }
  );
  return !!conflict;
}

/**
 * Moves every legacy per-collection field onto a stable generated identity.
 *
 * The value is copied before Settings starts pointing at the new key, and the legacy
 * key is only removed afterwards, from the items whose copy holds exactly the same
 * value. A run interrupted before that last step leaves the legacy key behind, which
 * is harmless: nothing reads an undeclared extra key, and formatForView never lifts
 * one carrying a native field name.
 */
export async function migrateExtraFieldIdentities(
  options: { collectionId?: any } = {}
): Promise<ExtraFieldIdentityMigrationSummary> {
  const summary: ExtraFieldIdentityMigrationSummary = { fields: 0, values: 0, references: 0, skipped: 0 };
  const settingsQuery = options.collectionId ? { collection: options.collectionId } : {};
  const settingsDocs = await Settings.find(settingsQuery).lean() as any[];

  // A freshly restored instance materializes no-code plugins just before this runs,
  // but the database remains a useful fallback for a partially rebuilt installation.
  const kindsByPluginId = new Map<string, string>();
  for (const plugin of registry.getAll()) kindsByPluginId.set(plugin.id, plugin.kind);
  const storedCustomPlugins = await CustomPlugin.find({}, 'id kind config').lean() as any[];
  for (const stored of storedCustomPlugins) {
    const id = stored.id || stored.config?.id;
    const kind = stored.kind || stored.config?.kind;
    if (id && kind) kindsByPluginId.set(String(id), String(kind));
  }

  for (const settings of settingsDocs) {
    if (!settings.collection) {
      console.warn(`[EXTRA FIELD MIGRATION] Settings ${settings._id} has no collection; skipped.`);
      summary.skipped += 1;
      continue;
    }

    const originalMap: ExtraFieldMap = settings.pluginExtraFields || {};
    const nextMap: ExtraFieldMap = { ...originalMap };
    let nextCustomization = settings.pluginCustomization || {};
    let settingsChanged = false;
    const cleanups: LegacyValueCleanup[] = [];

    for (const [pluginId, storedFields] of Object.entries(originalMap)) {
      if (!Array.isArray(storedFields) || storedFields.length === 0) continue;
      const plugin = registry.get(pluginId);
      const kind = plugin?.kind || kindsByPluginId.get(pluginId);
      if (!kind) {
        console.warn(`[EXTRA FIELD MIGRATION] ${pluginId}: plugin kind is unavailable; ${storedFields.length} field(s) left untouched.`);
        summary.skipped += storedFields.length;
        continue;
      }

      const unavailable = plugin
        ? reservedNamesFor(plugin)
        : new Set<string>();
      for (const field of storedFields) {
        if (field?.name) unavailable.add(field.name);
      }

      const nextFields: ExtraFieldConfig[] = [];
      const renames: FieldRename[] = [];

      for (let ordinal = 0; ordinal < storedFields.length; ordinal += 1) {
        const field = storedFields[ordinal];
        if (!field) {
          summary.skipped += 1;
          console.warn(`[EXTRA FIELD MIGRATION] ${pluginId}: empty field #${ordinal + 1}; skipped.`);
          continue;
        }
        if (!field.name || typeof field.name !== 'string') {
          nextFields.push(field);
          summary.skipped += 1;
          console.warn(`[EXTRA FIELD MIGRATION] ${pluginId}: field #${ordinal + 1} has no usable name; skipped.`);
          continue;
        }
        if (isManagedExtraFieldKey(field.name, field.keyVersion)) {
          nextFields.push(field);
          continue;
        }
        // The name ends up in dotted Mongo paths below. The editors never stored anything
        // else, so a name outside that shape comes from a hand-edited backup.
        if (!FIELD_NAME_RE.test(field.name)) {
          nextFields.push(field);
          summary.skipped += 1;
          console.warn(`[EXTRA FIELD MIGRATION] ${pluginId}: field #${ordinal + 1} has an invalid name; skipped.`);
          continue;
        }

        let attempt = 0;
        let candidate: string;
        while (true) {
          candidate = migratedExtraFieldKey(String(settings._id), pluginId, field.name, ordinal, attempt);
          const claimedByDefinition = unavailable.has(candidate);
          const conflictsInItems = !claimedByDefinition && await candidateHasConflictingValue(
            settings.collection,
            kind,
            field.name,
            candidate
          );
          if (!claimedByDefinition && !conflictsInItems) break;
          attempt += 1;
        }
        unavailable.add(candidate);

        const copied = await Item.collection.updateMany(
          {
            collection: settings.collection,
            kind,
            [`extra.${field.name}`]: { $exists: true },
            [`extra.${candidate}`]: { $exists: false }
          },
          [{ $set: { [`extra.${candidate}`]: `$extra.${field.name}` } }]
        );

        nextFields.push({ ...field, name: candidate, keyVersion: EXTRA_FIELD_KEY_VERSION });
        renames.push({ from: field.name, to: candidate });
        cleanups.push({ kind, from: field.name, to: candidate });
        summary.fields += 1;
        summary.values += copied.modifiedCount;
        settingsChanged = true;
        console.log(
          `[EXTRA FIELD MIGRATION] ${pluginId}.${field.name} -> ${candidate}; `
          + `${copied.modifiedCount} item value(s) copied.`
        );
      }

      if (renames.length > 0) {
        nextMap[pluginId] = nextFields;
        const rewritten = rewriteExtraFieldReferences(nextCustomization, pluginId, renames);
        nextCustomization = rewritten.customization;
        summary.references += rewritten.changed;
      }
    }

    if (settingsChanged) {
      await Settings.collection.updateOne(
        { _id: settings._id },
        { $set: { pluginExtraFields: nextMap, pluginCustomization: nextCustomization } }
      );

      for (const { kind, from, to } of cleanups) {
        const removed = await Item.collection.updateMany(
          {
            collection: settings.collection,
            kind,
            [`extra.${from}`]: { $exists: true },
            $expr: { $eq: [`$extra.${from}`, `$extra.${to}`] }
          },
          { $unset: { [`extra.${from}`]: '' } }
        );
        if (removed.modifiedCount > 0) {
          console.log(`[EXTRA FIELD MIGRATION] ${from}: legacy key removed from ${removed.modifiedCount} item(s).`);
        }
      }
    }
  }

  if (summary.fields > 0 || summary.skipped > 0) {
    console.log(
      `[EXTRA FIELD MIGRATION] Finished: ${summary.fields} field(s), `
      + `${summary.values} value(s), ${summary.references} reference(s), ${summary.skipped} skipped.`
    );
  }
  return summary;
}
