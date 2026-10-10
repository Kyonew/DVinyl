import { AiConfig, AiMessage } from './types';
import { aiChat } from './client';
import { extractJsonObject } from './jsonExtract';
import {
  CUSTOM_PLUGIN_PALETTE, isValidIcon, FIELD_TYPES, FIELD_NAME_RE,
  MAX_FIELD_OPTIONS, RESERVED_FIELD_NAMES, slugify, cleanText
} from '../customPluginStore';
import { CARD_ASPECT_RATIOS, DEFAULT_ASPECT_RATIO } from '../customPlugin';

/**
 * A first-draft custom-plugin config, shaped for `applyConfigToForm()` in
 * create-plugin.ejs — the same shape that page already uses to prefill itself
 * when editing an existing plugin. Never persisted directly: the admin reviews
 * and edits it in the builder, and the existing `/create-plugin/save` route does
 * the real validation (id collisions, the 30-plugin cap, reserved names) when
 * they click Save.
 */
export interface PluginDraft {
  label: string;
  icon: string;
  color: string;
  creatorLabel: string;
  aspectRatioClass: string;
  features: Record<string, boolean>;
  fields: { label: string; type: string; required: boolean; options?: { value: string; label: string }[] }[];
  formats: { label: string }[];
}

/** The six feature toggles the manual builder offers. `tracklist` is deliberately
 *  excluded: it is niche enough that an uninvited suggestion would be a distraction
 *  the reviewer has to notice and remove, not a helpful default. */
const FEATURE_KEYS = ['year', 'barcode', 'rating', 'comments', 'location', 'genre'] as const;

const MAX_DRAFT_FIELDS = 8;
const MAX_DRAFT_FORMATS = 6;

export function buildPluginGenerationPrompt(description: string): AiMessage[] {
  const paletteList = CUSTOM_PLUGIN_PALETTE.join(', ');
  const featureList = FEATURE_KEYS.join(', ');
  return [
    {
      role: 'system',
      content:
        'You design a collection-tracking form for a hobbyist. Given a short description of ' +
        'what they collect, answer with a single JSON object and nothing else, matching this ' +
        'shape exactly:\n' +
        '{"label": string, "icon": string, "color": string, "creatorLabel": string, ' +
        '"aspectRatioClass": string, "features": {string: boolean}, ' +
        '"fields": [{"label": string, "type": string, "required": boolean, "options"?: string[]}], ' +
        '"formats": [{"label": string}]}\n' +
        '"label" is a short plain-text name for the collection type (e.g. "Vintage Cameras"). ' +
        '"icon" is a single FontAwesome free-solid icon name prefixed "fa-" that fits the ' +
        'concept (e.g. "fa-camera-retro") — pick whatever fits best, not limited to any list. ' +
        `"color" must be exactly one of: ${paletteList}. ` +
        '"creatorLabel" is the label for the "who or what made this" field, worded for the ' +
        'concept (e.g. "Bottler" for bottles, "Photographer" for photos, "Manufacturer" for toys). ' +
        '"aspectRatioClass" must be exactly one of: "aspect-[2/3]" (tall, for anything book-, ' +
        'bottle- or box-shaped), "aspect-square" (for anything roughly as wide as tall, like ' +
        'coins or records), "aspect-[16/9]" (for anything wider than tall). ' +
        `"features" may set true for any of: ${featureList} — only the ones that genuinely fit ` +
        '(a "rating" makes sense for most collectibles; "barcode" only for retail-boxed items). ' +
        `Provide 3-${MAX_DRAFT_FIELDS} custom fields: attributes ` +
        'specific to the concept that are not already covered by the features above (e.g. for ' +
        'bottles: "Embossing", "Cap Type", "Volume"). "type" must be one of: text, number, ' +
        'textarea, select, boolean, tags, date. Give a select field an "options" array of 2-8 ' +
        'short choices. Only mark a field "required" when it is truly essential to identify ' +
        'the item. ' +
        `Provide 0-${MAX_DRAFT_FORMATS} "formats" only when the concept genuinely has ` +
        'format-like variants (e.g. bottle sizes, card conditions) — many concepts have none; ' +
        'in that case return an empty formats array rather than inventing hollow ones.'
    },
    {
      role: 'user',
      content: `Collection description: ${description}`
    }
  ];
}

const ASPECT_RATIOS: readonly string[] = CARD_ASPECT_RATIOS;

function sanitizeFieldName(label: string): string {
  return slugify(label).replace(/-/g, '_');
}

function sanitizeOptions(raw: any): { value: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_FIELD_OPTIONS)
    .map((o: any) => {
      const label = cleanText(typeof o === 'string' ? o : o?.label, 40);
      if (!label) return null;
      const value = sanitizeFieldName(label);
      return value ? { value, label } : null;
    })
    .filter((o): o is { value: string; label: string } => o !== null);
}

/**
 * Clamps whatever JSON the model returned into a shape `applyConfigToForm()` can
 * always render safely. Never throws, never rejects the whole draft over one bad
 * field: unusable pieces fall back to a safe default (see the design spec's
 * rationale — a draft is not a save, and the real validation happens once, at
 * `/create-plugin/save`, when the admin actually commits to it).
 */
export function sanitizePluginDraft(raw: any): PluginDraft {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const label = cleanText(source.label, 40);
  const icon = isValidIcon(String(source.icon || '')) ? String(source.icon) : 'fa-box';
  const color = CUSTOM_PLUGIN_PALETTE.includes(source.color) ? source.color : CUSTOM_PLUGIN_PALETTE[7];
  const creatorLabel = cleanText(source.creatorLabel, 30);
  const aspectRatioClass = ASPECT_RATIOS.includes(source.aspectRatioClass)
    ? source.aspectRatioClass
    : DEFAULT_ASPECT_RATIO;

  const features: Record<string, boolean> = {};
  const rawFeatures = source.features && typeof source.features === 'object' ? source.features : {};
  for (const key of FEATURE_KEYS) {
    if (rawFeatures[key] === true) features[key] = true;
  }

  const fields: PluginDraft['fields'] = [];
  const seenFieldNames = new Set<string>();
  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  for (const raw of rawFields.slice(0, MAX_DRAFT_FIELDS)) {
    const fieldLabel = cleanText(raw?.label, 40);
    if (!fieldLabel) continue;
    const name = sanitizeFieldName(fieldLabel);
    if (!FIELD_NAME_RE.test(name) || RESERVED_FIELD_NAMES.has(name) || seenFieldNames.has(name)) continue;
    seenFieldNames.add(name);

    const type = FIELD_TYPES.has(raw?.type) ? raw.type : 'text';
    const field: PluginDraft['fields'][number] = {
      label: fieldLabel,
      type,
      required: raw?.required === true
    };
    if (type === 'select') {
      const options = sanitizeOptions(raw?.options);
      if (options.length > 0) {
        field.options = options;
      } else {
        field.type = 'text';
      }
    }
    fields.push(field);
  }

  const formats: PluginDraft['formats'] = [];
  const seenFormatValues = new Set<string>();
  const rawFormats = Array.isArray(source.formats) ? source.formats : [];
  for (const raw of rawFormats.slice(0, MAX_DRAFT_FORMATS)) {
    const fmtLabel = cleanText(raw?.label, 30);
    if (!fmtLabel) continue;
    const value = sanitizeFieldName(fmtLabel);
    if (!value || seenFormatValues.has(value)) continue;
    seenFormatValues.add(value);
    formats.push({ label: fmtLabel });
  }

  return { label, icon, color, creatorLabel, aspectRatioClass, features, fields, formats };
}

/**
 * A sanitized first-draft plugin config from a free-text description, or null
 * when the call succeeded but returned nothing usable (unparsable JSON). Never
 * persists anything. Can throw when the AI call itself fails (transport/provider
 * error propagated from `aiChat`, e.g. a bad API key, wrong model name, or an
 * unreachable endpoint) — callers should catch and surface that error rather
 * than treat it the same as a `null` result.
 */
export async function generatePluginDraft(config: AiConfig, description: string): Promise<PluginDraft | null> {
  const result = await aiChat(config, buildPluginGenerationPrompt(description), {
    maxTokens: 1500,
    timeoutMs: 60000
  });
  const parsed = extractJsonObject(result.text);
  if (!parsed) return null;
  return sanitizePluginDraft(parsed);
}
