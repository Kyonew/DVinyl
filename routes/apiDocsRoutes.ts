import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { apiReference } from '@scalar/express-api-reference';
import { BASE_URL } from '../config/constants';

const router = Router();

// The hand-written OpenAPI document lives in the repo (not the built app), so read it
// per request: a spec edit shows up without rebuilding or restarting the app.
const SPEC_PATH = path.join(__dirname, '../docs/openapi.yaml');
const SPEC_URL = `${BASE_URL === '/' ? '' : BASE_URL}/api/v1/openapi.yaml`;

/** The OpenAPI document itself — public, no auth (it describes auth-protected routes). */
router.get('/api/v1/openapi.yaml', (req, res) => {
  fs.readFile(SPEC_PATH, 'utf8', (err, contents) => {
    if (err) {
      console.error('[API DOCS] Failed to read OpenAPI spec:', err.message);
      return res.status(500).json({ success: false, error: 'OpenAPI spec unavailable' });
    }
    res.type('text/yaml').send(contents);
  });
});

/**
 * Scalar API reference UI — public, loads its renderer from a CDN and the spec from
 * SPEC_URL. Mounted before the setup gate so it is reachable on a fresh instance.
 */
router.get('/api-docs', apiReference({ url: SPEC_URL, pageTitle: 'DVinyl API' }));

export = router;
