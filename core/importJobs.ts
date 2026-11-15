import crypto from 'crypto';
import { roomOf } from './notify';

/**
 * Bookkeeping for the bulk imports (CSV, AI, and every importer a plugin declares).
 *
 * An import answers its request at once (202) and then reports over socket.io. On their
 * own, those events are fragile: one missed while the socket is reconnecting (a laptop
 * waking up, a browser parking a tab, a proxy dropping the websocket) and the page waits
 * forever on an import that has long finished. So every event is also recorded here,
 * and the page can ask for the state of its import whenever it lost track of it.
 *
 * The same record is what keeps a second import out of a collection while one is still
 * running: two runs checking for duplicates before either has written anything both
 * conclude the item is new, and the collection ends up with two of it.
 *
 * Importers need no change: they keep calling req.io.emit(), and the middleware below
 * hands them an io that records the import events and sends them to the account that
 * started the import rather than to every connected page.
 *
 * Kept in memory on purpose: a restart kills the import anyway, and the page then
 * learns from an empty answer that its import is gone.
 */

export type ImportStatus = 'running' | 'finished' | 'error';

export interface ImportJob {
  id: string;
  userId: string;
  collectionId: string;
  status: ImportStatus;
  current: number;
  total: number;
  /** The payload of import_finished, as the importer sent it. */
  result?: Record<string, any>;
  error?: string;
  updatedAt: number;
}

/** A running import that has said nothing for this long is presumed dead. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** How long a finished import stays readable by a page that missed its end. */
export const KEEP_FINISHED_MS = 60 * 60 * 1000;

/** One entry per collection: the import running there, or the last one that ran. */
const jobs = new Map<string, ImportJob>();

const keyOf = (id: any): string => String(id ?? '');

function isAlive(job: ImportJob, now: number): boolean {
  return job.status === 'running' && now - job.updatedAt < STALE_AFTER_MS;
}

/** The import currently running in a collection, if any. */
export function runningImport(collectionId: any, now = Date.now()): ImportJob | null {
  const job = jobs.get(keyOf(collectionId));
  return job && isAlive(job, now) ? job : null;
}

/**
 * Registers a new import, or returns null when the collection already has one running.
 * A run that went silent past STALE_AFTER_MS no longer counts, so a crashed importer
 * cannot lock its collection for good.
 */
export function startImport(userId: any, collectionId: any, now = Date.now()): ImportJob | null {
  if (runningImport(collectionId, now)) return null;
  const job: ImportJob = {
    id: crypto.randomUUID(),
    userId: keyOf(userId),
    collectionId: keyOf(collectionId),
    status: 'running',
    current: 0,
    total: 0,
    updatedAt: now
  };
  jobs.set(job.collectionId, job);
  return job;
}

/** Forgets an import that never started, e.g. one its handler rejected with a 400. */
export function dropImport(job: ImportJob): void {
  if (jobs.get(job.collectionId) === job) jobs.delete(job.collectionId);
}

/** Folds one importer event into the record. Events that are not about imports are ignored. */
export function recordImportEvent(job: ImportJob, event: string, data: any, now = Date.now()): void {
  if (job.status !== 'running') return;
  if (event === 'import_progress') {
    job.current = Number(data?.current) || 0;
    job.total = Number(data?.total) || job.total;
  } else if (event === 'import_finished') {
    job.status = 'finished';
    job.result = { ...(data || {}) };
  } else if (event === 'import_error') {
    job.status = 'error';
    job.error = String(data?.message || '');
  } else {
    return;
  }
  job.updatedAt = now;
}

/**
 * The last import a user started in a collection, as the page needs it. A stale run is
 * reported as an error: whatever happened to it, it is not going to finish.
 */
export function importStateFor(userId: any, collectionId: any, now = Date.now()): ImportJob | null {
  const job = jobs.get(keyOf(collectionId));
  if (!job || job.userId !== keyOf(userId)) return null;
  if (job.status === 'running' && !isAlive(job, now)) return { ...job, status: 'error', error: '' };
  if (job.status !== 'running' && now - job.updatedAt > KEEP_FINISHED_MS) return null;
  return { ...job };
}

const IMPORT_EVENTS = new Set(['import_progress', 'import_finished', 'import_error']);

/**
 * Route middleware placed right before an import handler. Refuses the request while
 * another import runs in the collection, otherwise records the new one and gives the
 * handler an io that reports to the right place.
 */
export function trackImport(req: any, res: any, next: () => void): void {
  const collectionId = res.locals.activeCollectionId;
  const job = startImport(req.user?._id, collectionId);
  if (!job) {
    res.status(409).json({ error: req.t('admin.modal.import_already_running') });
    return;
  }

  const io = req.io;
  const room = roomOf(job.userId);
  // Everything but emit() is the real server, so an importer reaching for anything else
  // still finds it. Events other than the import ones keep their original reach.
  req.io = Object.create(io, {
    emit: {
      value(event: string, data: any) {
        if (!IMPORT_EVENTS.has(event)) return io.emit(event, data);
        recordImportEvent(job, event, data);
        return io.to(room).emit(event, { ...(data || {}), jobId: job.id });
      }
    }
  });

  // The page needs the id to tell its own import apart from an older one.
  const json = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode < 300 && body && typeof body === 'object' && !Array.isArray(body)) {
      return json({ ...body, jobId: job.id });
    }
    return json(body);
  };

  // A handler that turned the request down (bad URL, missing file) never started
  // anything, and must not leave the collection looking busy.
  res.on('finish', () => {
    if (res.statusCode >= 300) dropImport(job);
  });

  next();
}

/** Clears every record. Only meant for tests. */
export function resetImportJobs(): void {
  jobs.clear();
}
