import fs from 'fs';
import path from 'path';
import { PLUGINS_DIR } from './loadPlugins';
import { registry } from './registry';
import { CustomPluginConfig, CustomFieldConfig, CustomFormatConfig } from './customPlugin';
import { materializePlaceholder, sanitizePlaceholder } from './placeholderImage';
import { PluginDefinition } from './types';

/** Tailwind color names offered by the builder. The literal classes derived from
 *  them are safelisted in views/create-plugin.ejs so the JIT build includes them. */
export const CUSTOM_PLUGIN_PALETTE = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'stone'
] as const;

/** Curated FontAwesome icons offered by the builder (free text also accepted). */
export const CUSTOM_PLUGIN_ICONS = [
  'fa-box', 'fa-cube', 'fa-cubes', 'fa-puzzle-piece', 'fa-chess-knight', 'fa-dice',
  'fa-robot', 'fa-dragon', 'fa-ghost', 'fa-gem', 'fa-crown', 'fa-star',
  'fa-camera-retro', 'fa-palette', 'fa-paintbrush', 'fa-image', 'fa-scroll', 'fa-stamp',
  'fa-envelope', 'fa-coins', 'fa-sack-dollar', 'fa-shirt', 'fa-hat-wizard', 'fa-shoe-prints',
  'fa-guitar', 'fa-drum', 'fa-headphones', 'fa-radio', 'fa-tv', 'fa-camera',
  'fa-car', 'fa-motorcycle', 'fa-plane', 'fa-train', 'fa-ship', 'fa-rocket',
  'fa-book-open', 'fa-newspaper', 'fa-map', 'fa-globe', 'fa-flask', 'fa-microscope',
  'fa-paw', 'fa-feather', 'fa-leaf', 'fa-seedling', 'fa-wine-bottle', 'fa-mug-hot',
  'fa-utensils', 'fa-pizza-slice', 'fa-ice-cream', 'fa-candy-cane', 'fa-heart', 'fa-bolt'
] as const;

// Path segments already claimed by the core (mounted routes, static dirs, PWA files...).
// A custom plugin id becomes /<id> and /collection?type=<id>, so it must not shadow these.
const RESERVED_IDS = new Set([
  'setup', 'login', 'logout', 'register', 'admin', 'settings', 'backup', 'oidc', 'auth',
  'collection', 'wishlist', 'manual-add', 'import', 'api', 'add', 'save', 'confirm',
  'search', 'estimate', 'create-plugin', 'personnalisation', 'no-collection',
  'ressources', 'styles', 'socket.io', 'manifest.json', 'sw.js', 'core', 'plugins',
  'plugin-assets',
  'home', 'index', 'detail', 'edit', 'user', 'users'
]);

// Paths of the base Item schema + form plumbing: custom fields may not redefine them.
export const RESERVED_FIELD_NAMES = new Set([
  '_id', 'kind', 'owner', 'collection', 'title', 'year', 'cover_image', 'user_image',
  'in_wishlist', 'comments', 'location', 'quantity', 'genre', 'genres', 'styles',
  'barcode', 'barcode_locked', 'added_at', 'updated_at', 'creator', 'format',
  'tracklist', 'user_rating', 'mongo_id', 'extra'
]);

const ID_RE = /^[a-z][a-z0-9-]{1,29}$/;
export const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,29}$/;
const ICON_RE = /^fa-[a-z0-9-]{1,40}$/;
export const FIELD_TYPES = new Set(['text', 'number', 'textarea', 'select', 'boolean', 'tags', 'date']);

export function isValidIcon(icon: string): boolean {
  return ICON_RE.test(icon);
}

export function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function pascalCase(slug: string): string {
  return slug.split(/[-_]/).filter(Boolean).map(s => s[0]!.toUpperCase() + s.slice(1)).join('');
}

// Labels end up in EJS <script> blocks via JSON.stringify (admin.ejs module list,
// the builder's edit prefill), so angle brackets are stripped to rule out any
// </script> breakout regardless of the sink.
export function cleanText(value: any, max: number): string {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

/**
 * Validates and normalizes a builder submission into a CustomPluginConfig.
 * `existing` is the current config when editing (keeps `kind` stable).
 * Returns i18n error keys (create_plugin.err_*) so the UI stays translatable.
 */
const MAX_CUSTOM_PLUGINS = 30;

export function buildConfigFromSubmission(body: any, existing?: CustomPluginConfig): { config?: CustomPluginConfig; errors: string[] } {
  const errors: string[] = [];

  if (!existing && registry.getAll().filter(p => (p as any).customConfig).length >= MAX_CUSTOM_PLUGINS) {
    return { errors: ['create_plugin.err_too_many'] };
  }

  const label = cleanText(body.label, 40);
  if (!label) errors.push('create_plugin.err_label_required');

  const id = cleanText(body.id, 30) || slugify(label);
  if (!ID_RE.test(id)) {
    errors.push('create_plugin.err_bad_id');
  } else if (RESERVED_IDS.has(id) || id.startsWith('add-') || id.startsWith('save-') || id.startsWith('confirm-') || id.startsWith('search-')) {
    errors.push('create_plugin.err_reserved_id');
  }

  // Renames and new ids must not collide with another plugin or an existing folder
  const isRename = existing && existing.id !== id;
  if (ID_RE.test(id) && (!existing || isRename)) {
    const clash = registry.getAll().some(p => p.id === id || p.collectionType === id || p.routePrefix === `/${id}`);
    if (clash || fs.existsSync(path.join(PLUGINS_DIR, id))) {
      errors.push('create_plugin.err_id_taken');
    }
  }

  let icon = cleanText(body.icon, 42);
  if (!icon) icon = 'fa-box';
  if (!ICON_RE.test(icon)) errors.push('create_plugin.err_bad_icon');

  const color = CUSTOM_PLUGIN_PALETTE.includes(body.color) ? body.color : CUSTOM_PLUGIN_PALETTE[7];

  const creatorLabel = cleanText(body.creatorLabel, 30);
  if (!creatorLabel) errors.push('create_plugin.err_creator_required');

  // An absent key means "keep the stored image": the builder only posts this one when
  // the admin picks or removes an image, so the base64 never travels on every save.
  // Rejected rather than dropped when present but unusable, so an oversized upload or a
  // bad URL is reported instead of silently falling back to the generic logo.
  const rawDefaultCover = body.defaultCover === undefined
    ? (existing?.defaultCover || '')
    : (typeof body.defaultCover === 'string' ? body.defaultCover.trim() : '');
  const defaultCover = sanitizePlaceholder(rawDefaultCover);
  if (rawDefaultCover && !defaultCover) errors.push('create_plugin.err_bad_default_cover');

  const rawFeatures = body.features || {};
  const features: CustomPluginConfig['features'] = {};
  for (const key of ['year', 'barcode', 'rating', 'comments', 'location', 'genre', 'tracklist'] as const) {
    if (rawFeatures[key] === true || rawFeatures[key] === 'true' || rawFeatures[key] === 'on') features[key] = true;
  }

  const fields: CustomFieldConfig[] = [];
  const seenNames = new Set<string>();
  for (const raw of Array.isArray(body.fields) ? body.fields.slice(0, 15) : []) {
    const fieldLabel = cleanText(raw?.label, 40);
    if (!fieldLabel) continue; // ignore empty builder rows
    const name = FIELD_NAME_RE.test(cleanText(raw?.name, 30)) ? cleanText(raw.name, 30) : slugify(fieldLabel).replace(/-/g, '_');
    if (!FIELD_NAME_RE.test(name)) { errors.push('create_plugin.err_bad_field_name'); continue; }
    if (RESERVED_FIELD_NAMES.has(name)) { errors.push('create_plugin.err_reserved_field'); continue; }
    if (seenNames.has(name)) { errors.push('create_plugin.err_duplicate_field'); continue; }
    seenNames.add(name);

    const type = FIELD_TYPES.has(raw?.type) ? raw.type : 'text';
    const field: CustomFieldConfig = {
      name,
      label: fieldLabel,
      type,
      required: raw?.required === true || raw?.required === 'true',
      group: raw?.group === 'main' ? 'main' : 'metadata'
    };
    const placeholder = cleanText(raw?.placeholder, 60);
    if (placeholder) field.placeholder = placeholder;
    if (type === 'select') {
      const options = (Array.isArray(raw?.options) ? raw.options.slice(0, 20) : [])
        .map((o: any) => {
          const optLabel = cleanText(typeof o === 'string' ? o : o?.label, 40);
          const optValue = slugify(cleanText(typeof o === 'string' ? o : (o?.value || o?.label), 40)).replace(/-/g, '_');
          return optLabel && optValue ? { value: optValue, label: optLabel } : null;
        })
        .filter(Boolean) as { value: string; label: string }[];
      if (options.length === 0) { errors.push('create_plugin.err_select_needs_options'); continue; }
      field.options = options;
    }
    fields.push(field);
  }

  const formats: CustomFormatConfig[] = [];
  const seenFormats = new Set<string>();
  for (const raw of Array.isArray(body.formats) ? body.formats.slice(0, 12) : []) {
    const fmtLabel = cleanText(raw?.label, 30);
    if (!fmtLabel) continue;
    const value = slugify(cleanText(raw?.value, 30) || fmtLabel).replace(/-/g, '_');
    if (!value || seenFormats.has(value)) continue;
    seenFormats.add(value);
    const fmt: CustomFormatConfig = { value, label: fmtLabel };
    if (CUSTOM_PLUGIN_PALETTE.includes(raw?.color)) fmt.color = raw.color;
    formats.push(fmt);
  }

  // Preselected format: only a value that survived the format validation above, so
  // renaming or removing a format never leaves a dangling preselection behind.
  const rawDefaultFormat = slugify(cleanText(body.defaultFormat, 30)).replace(/-/g, '_');
  const defaultFormat = seenFormats.has(rawDefaultFormat) ? rawDefaultFormat : '';

  if (errors.length > 0) return { errors };

  const config: CustomPluginConfig = {
    custom: true,
    id,
    // The discriminator kind is minted once and survives edits/renames so
    // existing items (stored with kind=...) keep working.
    kind: existing?.kind || `Custom${pascalCase(id)}`,
    label,
    icon,
    color,
    order: existing?.order ?? 200,
    imageShape: body.imageShape === 'square' ? 'square' : 'poster',
    secondaryImage: body.secondaryImage === true || body.secondaryImage === 'true',
    creatorLabel,
    features,
    fields,
    formats
  };
  // Omitted rather than stored empty: an absent key means "use the generic logo"
  if (defaultCover) config.defaultCover = defaultCover;
  // Same idea: absent means "no preselected format"
  if (defaultFormat) config.defaultFormat = defaultFormat;

  return { config, errors: [] };
}

const GENERATED_INDEX = `// Auto-generated by the DVinyl plugin builder (/create-plugin).
// The source of truth is plugin.json; re-saving from the builder overwrites both files.
import { createCustomPlugin } from '../../core/customPlugin';

export default createCustomPlugin(require('./plugin.json'));
`;

export function writeCustomPluginDir(config: CustomPluginConfig): void {
  // Guard against path traversal: config.id may reach here unvalidated via the
  // DB->disk sync path (restore / boot), not just the validated builder route.
  if (!ID_RE.test(config.id)) throw new Error(`Invalid custom plugin id "${config.id}"`);
  const dir = path.join(PLUGINS_DIR, config.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'index.ts'), GENERATED_INDEX);
  // An uploaded default cover lives in the config; the file is only a serving cache,
  // rebuilt here so it also comes back on a boot/restore materialization.
  materializePlaceholder(dir, config.defaultCover);
}

export function deleteCustomPluginDir(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`Invalid custom plugin id "${id}"`);
  const dir = path.join(PLUGINS_DIR, id);
  // Only ever remove folders that are actually builder-generated
  if (!fs.existsSync(path.join(dir, 'plugin.json'))) {
    throw new Error(`plugins/${id} is not a custom plugin folder`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

export function isCustomPlugin(plugin: PluginDefinition): boolean {
  return !!(plugin as any).customConfig?.custom;
}

export function getCustomConfig(plugin: PluginDefinition): CustomPluginConfig | undefined {
  return (plugin as any).customConfig;
}
