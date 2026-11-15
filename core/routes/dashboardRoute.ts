import express from 'express';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { db } from '../db';
import { eq, idOf } from '../db/query';
import { dashboardWidgets, normalizeWidget, normalizeWidgets, resolveWidgets, widgetCatalogue, WidgetEnv, WidgetInstance } from '../dashboard';
import { createDashboardContext } from '../dashboardWidgets';
import { applyHomeCollection, homePathFor } from '../../utils/homePage';

const router = express.Router();

// The app's entry point (bookmark, PWA start_url, the logo, post-login): puts the user
// in their home collection and sends them to the page they chose to land on. The
// dashboard keeps its own path below so it stays reachable for someone whose home is
// the collection.
//
// Once per session, not on every visit, because '/' is also where the app sends people
// on its own: the collection switcher redirects here after switching, and re-applying
// the home collection on that hop would undo the switch on the way back. The express
// session cookie carries no maxAge, so it dies with the browser and a genuine relaunch
// gets a fresh one. Keyed by user id so signing in as somebody else in the same browser
// still lands on their own home.
router.get('/', requireAuth, async (req: any, res: any) => {
  const userId = String(req.user._id);
  if (req.session && req.session.homeAppliedFor !== userId) {
    req.session.homeAppliedFor = userId;
    await applyHomeCollection(req);
  }

  const target = homePathFor(req.user);
  // Callers reach '/' carrying a message to show ('/?msg=collection_created'), and the
  // page that displays one is the page being redirected to.
  const msg = typeof req.query.msg === 'string' ? req.query.msg : '';
  res.redirect(msg ? `${target}?msg=${encodeURIComponent(msg)}` : target);
});

router.get('/dashboard', requireAuth, async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      // The user is a member of no collection: explicit empty state, not a hollow dashboard
      return res.render('no-collection', { user: res.locals.user, msgKey: req.query.msg });
    }
    const env = widgetEnv(res);
    const entries = await prepareWidgets(resolveWidgets(env), res, env);
    res.render('index', {
      entries,
      dashboardWidgets,
      // The editor's catalogue, only shipped to whoever can arrange the page.
      widgetCatalogue: res.locals.isCollectionAdmin ? widgetCatalogue(env) : null,
      isCustomDashboard: Array.isArray(res.locals.settings?.dashboard?.widgets),
      user: res.locals.user,
      settings: res.locals.settings
    });
  } catch (err: any) {
    console.error("Dashboard route error:", err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// One widget on its own, as the page draws it: the random pick's "another one".
router.get('/dashboard/widgets/:id', requireAuth, requireCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    const env = widgetEnv(res);
    const widget = resolveWidgets(env).find(w => w.id === req.params.id);
    if (!widget) return res.status(404).send('');
    const [entry] = await prepareWidgets([widget], res, env);
    renderFrame(res, entry!, (html) => res.send(html));
  } catch (err: any) {
    console.error('[ERR] dashboard widget', err.message);
    res.status(500).send('');
  }
});

// The editor previews a widget it is adding or reconfiguring before anything is saved.
router.post('/dashboard/widgets/render', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const env = widgetEnv(res);
    const widget = normalizeWidget(req.body?.widget, env);
    if (!widget) return res.status(400).json({ success: false });
    const [entry] = await prepareWidgets([widget], res, env);
    renderFrame(res, entry!, (html) => res.json({ success: true, widget, html }));
  } catch (err: any) {
    console.error('[ERR] dashboard widget render', err.message);
    res.status(500).json({ success: false });
  }
});

// The whole arrangement, saved as the editor changes it.
router.post('/dashboard/layout', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const widgets = normalizeWidgets(req.body?.widgets, widgetEnv(res));
    await db.settings.updateOne(eq('collection', idOf(res.locals.activeCollectionId)), { set: { dashboard: { widgets } } }, { upsert: true });
    res.json({ success: true, widgets });
  } catch (err: any) {
    console.error('[ERR] dashboard layout save', err.message);
    res.status(500).json({ success: false });
  }
});

// Back to the page a collection gets before anyone arranges it.
router.post('/dashboard/layout/reset', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
  try {
    await db.settings.updateOne(eq('collection', idOf(res.locals.activeCollectionId)), { unset: ['dashboard'] });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] dashboard layout reset', err.message);
    res.status(500).json({ success: false });
  }
});

function widgetEnv(res: any): WidgetEnv {
  return {
    settings: res.locals.settings,
    registry: res.locals.registry,
    t: res.locals.t,
    currency: res.locals.user?.currency
  };
}

export interface PreparedWidget {
  widget: WidgetInstance;
  data: any;
  // Nothing to show: left out of the page, a placeholder while arranging it.
  empty: boolean;
}

/**
 * Loads every widget's data side by side. A widget whose data fails to load is drawn as
 * empty rather than taking the whole home page down with it.
 */
async function prepareWidgets(widgets: WidgetInstance[], res: any, env: WidgetEnv): Promise<PreparedWidget[]> {
  const context = createDashboardContext(res);
  return Promise.all(widgets.map(async widget => {
    const type = dashboardWidgets.get(widget.type)!;
    try {
      const data = type.load ? await type.load(context, widget.options, env) : null;
      const empty = type.isEmpty ? type.isEmpty(data, widget.options, res.locals) : false;
      return { widget, data, empty };
    } catch (err: any) {
      console.error(`[ERR] dashboard widget ${widget.type}`, err.message);
      return { widget, data: null, empty: true };
    }
  }));
}

function renderFrame(res: any, entry: PreparedWidget, send: (html: string) => void) {
  res.render('partials/dashboard/frame', { entry, dashboardWidgets }, (err: any, html: string) => {
    if (err) {
      console.error('[ERR] dashboard widget partial', err.message);
      return res.status(500).send('');
    }
    send(html);
  });
}

export default router;
