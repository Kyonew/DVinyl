import { getCollectionSettings } from './collectionSettings';
import { failImportJob, finishImportJob, ImportJob, ImportJobResult, setImportProgress } from './importJobs';

/**
 * Runs an existing importer handler as an API job.
 *
 * The handlers were written for the web admin UI: they answer 202 themselves, read the
 * target collection from `res.locals.activeCollectionId`, and stream progress over
 * socket.io. Rather than refactor every plugin importer, this adapter feeds them a stub
 * response (so they can write freely without touching the real one), points their locals
 * at the API's collection, and mirrors their socket events into the job record while
 * still forwarding them to the real socket, so the web UI is unaffected.
 */

export interface StartImportJobParams {
  req: any;
  res: any;
  job: ImportJob;
  /** The collection the run targets; omitted for instance-level jobs. */
  collection?: any;
  run: (req: any, res: any) => Promise<any> | any;
}

/** Importers report `count`; the API's stable key is `imported`. */
function normalizeResult(payload: any): ImportJobResult {
  if (!payload || typeof payload !== 'object') return {};
  const result: ImportJobResult = { ...payload };
  if (typeof payload.count === 'number' && result.imported === undefined) {
    result.imported = payload.count;
  }
  return result;
}

export function startImportJob(params: StartImportJobParams): void {
  const { req, res, job, collection, run } = params;

  let captured: any = null;
  let capturedStatus = 200;

  const stubRes: any = {
    locals: res.locals,
    headersSent: false,
    status(code: number) { capturedStatus = code; return stubRes; },
    json(body: any) { captured = body; return stubRes; },
    send(body: any) { captured = body; return stubRes; },
    setHeader() { return stubRes; },
    cookie() { return stubRes; },
    end() { return stubRes; },
    destroy() {}
  };

  const realIo = req.io;
  const io: any = Object.create(realIo || {});
  io.emit = (event: string, payload: any) => {
    if (event === 'import_progress') {
      setImportProgress(job, payload?.current ?? job.current, payload?.total ?? job.total);
    } else if (event === 'import_finished') {
      finishImportJob(job, normalizeResult(payload));
    } else if (event === 'import_error') {
      failImportJob(job, String(payload?.message || 'Import failed'));
    }
    try {
      realIo?.emit?.(event, payload);
    } catch {
      // A dead socket must never fail an import.
    }
    return true;
  };

  const stubReq: any = Object.create(req || {});
  stubReq.io = io;

  if (collection) {
    res.locals.activeCollectionId = collection._id;
    res.locals.activeCollection = collection;
    res.locals.user = req.user;
  }

  Promise.resolve()
    .then(async () => {
      if (collection) {
        res.locals.settings = await getCollectionSettings(collection._id);
      }
      return run(stubReq, stubRes);
    })
    .then(() => {
      if (job.status !== 'running') return;
      if (capturedStatus >= 400) {
        failImportJob(job, typeof captured?.error === 'string' ? captured.error : 'Import failed');
        return;
      }
      finishImportJob(job, captured && typeof captured === 'object' ? normalizeResult(captured) : null);
    })
    .catch((err: any) => {
      failImportJob(job, err?.message || 'Import failed');
    });
}
