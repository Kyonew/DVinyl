/**
 * The Personnalisation studio's draft: changes to a collection's look (layout, colours,
 * card shape, shortcuts, fast add) that its admin is trying out and has not published.
 *
 * The draft lives in the admin's session, as the same settings update the save route
 * would write, and only applies to pages loaded inside the studio's preview (their URL
 * carries ?studio=1). Every other page, and every other member, keeps seeing the saved
 * settings until the draft is published.
 */

export const STUDIO_PARAM = 'studio';

interface StoredDraft {
  collectionId: string;
  update: Record<string, any>;
}

export function getDraft(req: any, collectionId: any): Record<string, any> | null {
  const draft: StoredDraft | undefined = req.session?.lookDraft;
  return draft && collectionId && draft.collectionId === String(collectionId) ? draft.update : null;
}

export function setDraft(req: any, collectionId: any, update: Record<string, any>): void {
  if (req.session) req.session.lookDraft = { collectionId: String(collectionId), update };
}

export function clearDraft(req: any): void {
  if (req.session) delete req.session.lookDraft;
}

/**
 * A copy of the settings with an update applied, the original left untouched. Keys are
 * field paths as the save route writes them ('theme.music.preset', 'layout'...): every
 * object along a path is copied before being written to.
 */
export function withUpdate(settings: any, update: Record<string, any>): any {
  const copy = { ...settings };
  for (const [path, value] of Object.entries(update)) {
    const keys = path.split('.');
    let target = copy;
    for (const key of keys.slice(0, -1)) {
      const current = target[key];
      const next = current instanceof Map ? Object.fromEntries(current) : { ...(current && typeof current === 'object' ? current : {}) };
      target[key] = next;
      target = next;
    }
    target[keys[keys.length - 1]!] = value;
  }
  return copy;
}

/** Whether this request is a page drawn inside the studio's preview. */
export function isStudioRequest(req: any, res: any): boolean {
  return req.method === 'GET' && req.query?.[STUDIO_PARAM] === '1' && Boolean(res.locals.isCollectionAdmin);
}
