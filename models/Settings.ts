import mongoose from 'mongoose';
import { registry } from '../core/registry';

const themeSchema = new mongoose.Schema({
    preset: { type: String, default: 'default' }
}, { _id: false });

// Defaults are lazy (evaluated at document creation), so the plugin registry is
// already populated and every registered plugin, including new ones, is covered.
const settingsSchema = new mongoose.Schema({
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
    fastAdd: { type: String, default: '' },
    visibility: {
        applyToAdmin: { type: Boolean, default: false },
        hiddenItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Item' }],
        hiddenGenres: [{ type: String }],
        hiddenTypes: [{ type: String }]
    }
});

export = mongoose.model('Settings', settingsSchema);