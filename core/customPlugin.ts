import { PluginDefinition, FieldDefinition, FormatOption, StatWidget, NavbarShortcut } from './types';
import { escapeRegExp } from './helpers';
import { DEFAULT_PLACEHOLDER_IMAGE, placeholderUrl } from './placeholderImage';
import Item from '../models/Item';

/**
 * Config of a user-created ("custom") plugin, persisted as plugins/<id>/plugin.json
 * and turned into a full PluginDefinition by createCustomPlugin().
 *
 * Custom plugins are manual-only: no external search provider, no refresh. Everything
 * else (collection tab, navbar, widgets, wishlist, badges...) behaves like a native plugin.
 */
export interface CustomPluginConfig {
  custom: true;
  id: string; // slug, folder name, collectionType and routePrefix (/<id>)
  kind: string; // Mongoose discriminator, generated once ("CustomFigurines"), stable across edits
  label: string; // plain-text display name (used verbatim, i18next falls back to the key)
  icon: string; // FontAwesome icon (fa-xxx)
  color?: string; // Tailwind color name (e.g. 'teal') driving badges/widgets accents
  order?: number; // display order, defaults to 200 (after the built-in plugins)
  imageShape?: 'poster' | 'square';
  secondaryImage?: boolean; // show the secondary (user) image editor
  // Image used for items with no cover: either an http(s) URL or an uploaded
  // base64 data URI (see placeholderImage.ts). Absent means the generic logo.
  defaultCover?: string;
  creatorLabel: string; // plain-text label of the creator field ("Artiste", "Fabricant"...)
  features?: {
    year?: boolean;
    barcode?: boolean;
    rating?: boolean; // personal rating out of 5 (stored as user_rating)
    comments?: boolean;
    location?: boolean;
    genre?: boolean;
    tracklist?: boolean; // music-style position/title/duration list
  };
  fields?: CustomFieldConfig[];
  formats?: CustomFormatConfig[];
  // Format preselected on a new item. Empty (or absent) leaves the picker blank so the
  // format is a conscious choice instead of whichever one happens to be declared first.
  defaultFormat?: string;
}

export interface CustomFieldConfig {
  name: string; // slug, becomes the Mongo path
  label: string; // plain text
  type: 'text' | 'number' | 'textarea' | 'select' | 'boolean' | 'tags' | 'date';
  required?: boolean;
  group?: 'main' | 'metadata';
  placeholder?: string;
  options?: { value: string; label: string }[]; // for type 'select'
  default?: any;
}

export interface CustomFormatConfig {
  value: string; // slug
  label: string; // plain text
  color?: string; // Tailwind color name, defaults to the plugin color
}

const DEFAULT_COLOR = 'teal';

// Shared partials for every custom plugin (generic tracklist editor/view)
const CUSTOM_PARTIALS_PATH = 'core/views/partials/custom';

function widgetCountClasses(color: string) {
  return { color: `bg-${color}-100 dark:bg-${color}-900/30`, text: `text-${color}-600` };
}

export function createCustomPlugin(config: CustomPluginConfig): PluginDefinition {
  const color = config.color || DEFAULT_COLOR;
  // config.icon carries the full FontAwesome class ('fa-box'); PluginDefinition.icon
  // is prefix-less ('box', the views prepend 'fa-'), widgets/fastAdd want the full class.
  const faIcon = config.icon.startsWith('fa-') ? config.icon : `fa-${config.icon}`;
  const bareIcon = faIcon.slice(3);
  const features = config.features || {};
  const customFields = config.fields || [];
  const placeholder = placeholderUrl(config.id, config.defaultCover) || DEFAULT_PLACEHOLDER_IMAGE;
  const formats: FormatOption[] = (config.formats || []).map(f => ({
    value: f.value,
    label: f.label,
    color: `bg-${f.color || color}-600/90`
  }));

  // ---- Schema -------------------------------------------------------------
  // Base Item paths (title, year, barcode, comments, location, genre...) already
  // exist on the parent schema; only plugin-specific paths are declared here.
  const schemaDefinition: Record<string, any> = {
    creator: { type: String, required: true }
  };
  // Only a declared format value counts; anything else (including a format later removed
  // from the config) falls back to "no format".
  const defaultFormat = formats.some(f => f.value === config.defaultFormat) ? config.defaultFormat! : '';

  if (formats.length > 0) {
    schemaDefinition.format = {
      type: String,
      // '' is a legitimate stored value: an item can be owned without its edition known
      enum: ['', ...formats.map(f => f.value)],
      default: defaultFormat
    };
  }
  if (features.rating) {
    schemaDefinition.user_rating = { type: Number, min: 0, max: 5, default: 0 };
  }
  if (features.tracklist) {
    schemaDefinition.tracklist = [{ position: String, title: String, duration: String }];
  }
  for (const f of customFields) {
    schemaDefinition[f.name] =
      f.type === 'number' ? Number
        : f.type === 'boolean' ? { type: Boolean, default: !!f.default }
          : f.type === 'tags' ? { type: [String], default: [] }
            : f.type === 'date' ? Date
              : String;
  }

  // ---- Form fields ----------------------------------------------------------
  const showAll: FieldDefinition['showIn'] = ['edit', 'confirm', 'detail', 'manual'];
  const showForm: FieldDefinition['showIn'] = ['edit', 'confirm', 'manual'];

  const formFields: FieldDefinition[] = [
    { name: 'title', label: 'confirm_vinyl.field_title', type: 'text', required: true, showIn: showAll, group: 'main' },
    { name: 'creator', label: config.creatorLabel, type: 'text', required: true, showIn: showAll, group: 'main' }
  ];

  if (formats.length > 0) {
    formFields.push({
      name: 'format',
      label: 'confirm_vinyl.field_format',
      type: 'select',
      showIn: showForm,
      group: 'main',
      // The blank entry is always offered: without it a <select> silently selects its
      // first option, which is exactly the accidental value this avoids.
      options: [
        { value: '', label: 'common.no_format' },
        ...formats.map(f => ({ value: f.value, label: f.label }))
      ]
    });
  }

  formFields.push({ name: 'quantity', label: 'confirm_vinyl.field_quantity', type: 'number', showIn: showForm, group: 'main' });

  for (const f of customFields.filter(f => (f.group || 'metadata') === 'main')) {
    formFields.push(toFieldDefinition(f, 'main'));
  }

  if (features.tracklist) {
    formFields.push({
      name: 'tracklist',
      label: 'confirm_vinyl.tracklist_label',
      type: 'custom',
      partial: 'tracklist-editor',
      showIn: showForm,
      group: 'main'
    });
  }

  if (features.year) {
    formFields.push({ name: 'year', label: 'confirm_vinyl.year_label', type: 'text', showIn: showAll, group: 'metadata', placeholder: 'placeholders.year' });
  }
  if (features.barcode) {
    formFields.push({ name: 'barcode', label: 'confirm_vinyl.barcode_label', type: 'text', showIn: showForm, group: 'metadata', placeholder: 'EAN...' });
  }
  if (features.genre) {
    formFields.push({ name: 'genres', label: 'confirm_vinyl.field_genres', type: 'tags', showIn: showForm, group: 'metadata', placeholder: 'Rock, Pop...' });
  }

  for (const f of customFields.filter(f => (f.group || 'metadata') === 'metadata')) {
    formFields.push(toFieldDefinition(f, 'metadata'));
  }

  if (features.rating) {
    formFields.push({ name: 'user_rating', label: 'confirm_dvd.field_rating', type: 'number', showIn: showForm, group: 'metadata', placeholder: '0 - 5' });
  }
  if (features.comments) {
    formFields.push({ name: 'comments', label: 'confirm_vinyl.field_comments', type: 'textarea', showIn: showForm, group: 'metadata', placeholder: 'confirm_vinyl.comments_placeholder' });
  }
  if (features.location) {
    formFields.push({ name: 'location', label: 'common.location', type: 'text', showIn: showForm, group: 'metadata', placeholder: 'placeholders.location' });
  }

  // ---- Widgets / navbar -----------------------------------------------------
  const statsWidgets: StatWidget[] = [
    { id: `${config.id}_total`, label: config.label, icon: faIcon, ...widgetCountClasses(color), kind: 'count' },
    { id: `${config.id}_creator`, label: config.creatorLabel, icon: 'fa-user', color: `bg-${color}-100 dark:bg-${color}-500/20`, kind: 'top' }
  ];
  for (const f of config.formats || []) {
    statsWidgets.push({
      id: `${config.id}_${f.value}`,
      label: f.label,
      icon: faIcon,
      ...widgetCountClasses(f.color || color),
      kind: 'count'
    });
  }

  const navbarShortcuts: NavbarShortcut[] = [
    { id: config.id, label: config.label, url: `/collection?type=${config.id}` },
    ...(config.formats || []).map(f => ({
      id: `${config.id}_${f.value}`,
      label: f.label,
      url: `/collection?type=${config.id}&format=${f.value}`
    }))
  ];

  // ---- Defaults ---------------------------------------------------------------
  // cover_image stays empty: the placeholder is resolved at render time, so an item
  // added without a cover follows the plugin's default image if it changes later.
  const manualDefaults: Record<string, any> = {
    title: '',
    creator: '',
    quantity: 1,
    cover_image: '',
    user_image: ''
  };
  if (formats.length > 0) manualDefaults.format = defaultFormat;
  if (features.year) manualDefaults.year = '';
  if (features.barcode) manualDefaults.barcode = '';
  if (features.genre) manualDefaults.genres = [];
  if (features.rating) manualDefaults.user_rating = 0;
  if (features.comments) manualDefaults.comments = '';
  if (features.location) manualDefaults.location = '';
  if (features.tracklist) manualDefaults.tracklist = [];
  for (const f of customFields) {
    manualDefaults[f.name] = f.default !== undefined ? f.default
      : f.type === 'boolean' ? false
        : f.type === 'tags' ? []
          : f.type === 'select' ? (f.options?.[0]?.value ?? '')
            : ''; // 'date' included: the date input reads an empty string as "no value"
  }

  // Exact duplicate: same title + creator (case-insensitive), same format if declared
  function duplicateQuery(collectionId: any, data: Record<string, any>, withFormat: boolean) {
    const query: any = {
      collection: collectionId,
      in_wishlist: false,
      kind: config.kind,
      title: { $regex: new RegExp(`^${escapeRegExp((data.title || '').trim())}$`, 'i') },
      creator: { $regex: new RegExp(`^${escapeRegExp((data.creator || '').trim())}$`, 'i') }
    };
    if (withFormat && formats.length > 0 && data.format) {
      query.format = data.format;
    }
    return query;
  }

  const plugin: PluginDefinition = {
    id: config.id,
    kind: config.kind,
    label: config.label,
    i18nKey: config.id,
    icon: bareIcon,
    order: config.order ?? 200,
    routePrefix: `/${config.id}`,
    collectionType: config.id,
    creatorField: 'creator',
    supportsUserImage: config.secondaryImage === true,
    placeholderImage: placeholder,
    defaultCardFields: ['creator'],
    partialsPath: CUSTOM_PARTIALS_PATH,

    schemaDefinition,
    formFields,
    formats,
    statsWidgets,
    navbarShortcuts,

    fastAddOptions: [{
      value: config.id,
      label: config.label,
      icon: faIcon,
      color: `peer-checked:bg-${color}-600`,
      url: `/manual-add?type=${config.id}`
    }],

    getStats(items: any[]): Record<string, any> {
      const qty = (i: any) => Number(i.quantity || 1);
      const stats: Record<string, any> = {
        [`${config.id}_total`]: items.reduce((acc, i) => acc + qty(i), 0)
      };
      for (const f of formats) {
        stats[`${config.id}_${f.value}`] = items
          .filter(i => (i.format || '') === f.value)
          .reduce((acc, i) => acc + qty(i), 0);
      }
      const counts: Record<string, number> = {};
      let topName = 'N/A', topCount = 0;
      for (const item of items) {
        if (!item.creator) continue;
        counts[item.creator] = (counts[item.creator] || 0) + 1;
        if (counts[item.creator]! > topCount) {
          topCount = counts[item.creator]!;
          topName = item.creator;
        }
      }
      stats[`${config.id}_creator`] = { name: topName, count: topCount };
      return stats;
    },

    formatForView(item: any): any {
      if (!item) return null;
      const obj = item.toObject ? item.toObject() : item;
      return {
        ...manualDefaults,
        ...obj,
        creator: obj.creator || 'Unknown',
        cover_image: obj.cover_image || DEFAULT_PLACEHOLDER_IMAGE,
        quantity: obj.quantity || 1
      };
    },

    async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
      if (!(data.title || '').trim() || !(data.creator || '').trim()) return null;
      return Item.findOne(duplicateQuery(collectionId, data, true));
    },

    async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
      if (!(data.title || '').trim() || !(data.creator || '').trim()) return [];
      return Item.find(duplicateQuery(collectionId, data, false)).lean();
    },

    async getVariants(item: any): Promise<any[]> {
      if (!item) return [];
      return Item.find({
        collection: item.collection,
        in_wishlist: false,
        kind: config.kind,
        _id: { $ne: item._id },
        title: { $regex: new RegExp(`^${escapeRegExp(item.title || '')}$`, 'i') },
        creator: { $regex: new RegExp(`^${escapeRegExp(item.creator || '')}$`, 'i') }
      }).lean();
    },

    getManualDefaults(): Record<string, any> {
      return JSON.parse(JSON.stringify(manualDefaults));
    },

    // The generic save handler forwards tags inputs as a raw comma-separated
    // string; split it here so the [String] schema paths store real arrays.
    normalizeForSave(data: Record<string, any>): void {
      for (const f of customFields) {
        if (f.type === 'tags' && typeof data[f.name] === 'string') {
          data[f.name] = data[f.name].split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      }
    }
  };

  if (config.imageShape === 'square') plugin.aspectRatioClass = 'aspect-square';
  if (formats.length > 0) plugin.duplicateCheckFields = ['format'];
  if (features.tracklist) plugin.detailZones = [{ id: 'content', partial: 'tracklist-view' }];

  // Marks the plugin as user-created (drives the edit/delete UI in /create-plugin)
  (plugin as any).customConfig = config;

  return plugin;
}

function toFieldDefinition(f: CustomFieldConfig, group: 'main' | 'metadata'): FieldDefinition {
  const field: FieldDefinition = {
    name: f.name,
    label: f.label,
    type: f.type,
    required: f.required === true,
    // 'detail' included so a user-defined field is readable on the item page and not
    // only in the edit form. The detail view skips the paths it renders in dedicated
    // sections, so nothing is displayed twice.
    showIn: ['edit', 'confirm', 'detail', 'manual'],
    group
  };
  if (f.placeholder) field.placeholder = f.placeholder;
  if (f.type === 'select') field.options = f.options || [];
  if (f.default !== undefined) field.default = f.default;
  return field;
}
