import express from 'express';
import fs from 'fs';
import path from 'path';
import { PLUGINS_DIR } from '../core/loadPlugins';
import { PLACEHOLDER_FILE_RE } from '../core/placeholderImage';

/**
 * Static assets materialized inside a plugin folder (currently the default cover).
 *
 * Served by a dedicated route rather than express.static(PLUGINS_DIR): the folder also
 * holds plugin.json and .ts sources, which must never be reachable over HTTP. Only the
 * content-hashed placeholder names are accepted, so the response can be cached forever.
 *
 * Public on purpose: covers show up on pages rendered before auth resolves (login
 * redirects, PWA shell) and the image carries nothing sensitive.
 */
const router = express.Router();

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,29}$/;

router.get('/:pluginId/:file', (req: any, res: any) => {
  const { pluginId, file } = req.params;
  if (!PLUGIN_ID_RE.test(pluginId) || !PLACEHOLDER_FILE_RE.test(file)) {
    return res.status(404).end();
  }

  const filePath = path.join(PLUGINS_DIR, pluginId, file);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  // The file name carries a hash of its own bytes, so a changed image means a changed URL.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(filePath);
});

export default router;
