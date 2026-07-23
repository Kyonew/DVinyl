import mongoose from 'mongoose';

// Persisted definition of a user-created ("no-code") plugin built via /create-plugin.
//
// The plugins/<id>/ folder on disk (plugin.json + generated index.ts) is a
// regenerable cache: this document is the source of truth. Storing it in Mongo
// means custom types survive container rebuilds (the folder is re-materialized at
// boot, see core/customPluginSync.ts) and are included in instance backups.
const customPluginSchema = new mongoose.Schema({
    // Plugin id / slug (folder name, collectionType, routePrefix). Unique per instance.
    id: {
        type: String,
        required: true,
        unique: true
    },
    // Mongoose discriminator kind, minted once and stable across edits/renames.
    kind: {
        type: String,
        required: true
    },
    // The full CustomPluginConfig (see core/customPlugin.ts), stored verbatim.
    config: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const CustomPlugin = mongoose.model('CustomPlugin', customPluginSchema);

export = CustomPlugin;
