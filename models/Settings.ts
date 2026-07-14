import mongoose from 'mongoose';
import { registry } from '../core/registry';

const themeSchema = new mongoose.Schema({
    preset: { type: String, default: 'default' }
}, { _id: false });

// Defaults are lazy (evaluated at document creation), so the plugin registry is
// already populated and every registered plugin, including new ones, is covered.
const settingsSchema = new mongoose.Schema({
    // One Settings document per collection ("container" isolation: theme, modules,
    // visibility, plugin settings all scoped). Backfilled by utils/migrate.ts for
    // pre-multi-collection installs; created lazily by settingsMiddleware for new collections.
    collection: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection' },
    siteName: { type: String, default: 'DVinyl' },
    modules: {
        type: Map,
        of: Boolean,
        default: () => new Map(Object.entries(registry.getDefaultModules()))
    },
    theme: {
        type: Map,
        of: themeSchema,
        default: () => new Map(Object.entries(registry.getDefaultThemes()))
    },
    navbarShortcuts: {
        type: [String],
        default: () => registry.getDefaultNavbarShortcuts()
    },
    statsWidgets: {
        type: [String],
        default: () => registry.getDefaultStatsWidgets()
    },
    // Plugin-scoped settings: { [pluginId]: { [key]: value } }, e.g. { music: { advancedCD: true } }
    pluginSettings: {
        type: mongoose.Schema.Types.Mixed,
        default: () => registry.getDefaultPluginSettings()
    },
    // Per-collection cosmetic overrides applied on top of the shared plugin
    // definitions: { [pluginId]: { icon: 'fa-xxx', formatColors: { [formatValue]: paletteColor } } }
    pluginCustomization: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({})
    },
    fastAdd: { type: String, default: '' },
    visibility: {
        applyToAdmin: { type: Boolean, default: false },
        hiddenItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Item' }],
        hiddenGenres: [{ type: String }],
        hiddenTypes: [{ type: String }]
    }
// `collection` path is deliberate (per-collection settings); read via .lean() only.
}, { suppressReservedKeysWarning: true });

// Partial (not sparse-on-missing) unique index: guarantees at most one Settings doc
// per collection under concurrent first-visit upserts, without rejecting the
// collection-less docs a legacy backup restore may transiently create.
settingsSchema.index(
    { collection: 1 },
    { unique: true, partialFilterExpression: { collection: { $exists: true } } }
);

export = mongoose.model('Settings', settingsSchema);