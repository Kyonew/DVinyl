import express from 'express';
import apiV1Routes from '../../routes/api/v1/index';

/**
 * The /api/v1 surface with only what it needs: JSON body parsing, the couple of
 * request/response fields app.ts injects globally, and the router itself. The
 * production app's session, i18n, IP-block and setup-gate middleware are
 * deliberately absent (see the spec's "Approach" section).
 */
export function buildApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use((req: any, res: any, next: any) => {
    req.t = (key: string) => key;
    req.io = { emit() {}, to() { return { emit() {} }; } };
    res.locals = {};
    next();
  });
  app.use('/api/v1', apiV1Routes);
  app.use((req: any, res: any) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });
  return app;
}
