import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  dropImport,
  importStateFor,
  KEEP_FINISHED_MS,
  recordImportEvent,
  resetImportJobs,
  runningImport,
  STALE_AFTER_MS,
  startImport,
  trackImport
} from '../core/importJobs';

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const COLLECTION = 'cccccccccccccccccccccccc';

describe('import jobs', () => {
  beforeEach(() => resetImportJobs());

  it('refuses a second import in a collection while one runs', () => {
    assert.ok(startImport(USER, COLLECTION, 0));
    assert.equal(startImport(OTHER, COLLECTION, 1000), null);
    assert.ok(startImport(USER, 'dddddddddddddddddddddddd', 1000));
  });

  it('lets a new import in once the previous one ended', () => {
    const job = startImport(USER, COLLECTION, 0)!;
    recordImportEvent(job, 'import_finished', { count: 3 }, 10);
    assert.equal(runningImport(COLLECTION, 20), null);
    assert.ok(startImport(USER, COLLECTION, 20));
  });

  it('does not let a silent import lock its collection for good', () => {
    startImport(USER, COLLECTION, 0);
    assert.ok(startImport(USER, COLLECTION, STALE_AFTER_MS + 1));
  });

  it('keeps progress and result for the page that missed the events', () => {
    const job = startImport(USER, COLLECTION, 0)!;
    recordImportEvent(job, 'import_progress', { current: 2, total: 9 }, 10);
    const running = importStateFor(USER, COLLECTION, 20)!;
    assert.deepEqual([running.status, running.current, running.total], ['running', 2, 9]);
    recordImportEvent(job, 'import_finished', { count: 9, updated: 0 }, 30);
    const state = importStateFor(USER, COLLECTION, 40)!;
    assert.equal(state.status, 'finished');
    assert.deepEqual(state.result, { count: 9, updated: 0 });
  });

  it('ignores events once the import is over', () => {
    const job = startImport(USER, COLLECTION, 0)!;
    recordImportEvent(job, 'import_error', { message: 'boom' }, 10);
    recordImportEvent(job, 'import_finished', { count: 1 }, 20);
    assert.equal(importStateFor(USER, COLLECTION, 30)!.status, 'error');
    assert.equal(importStateFor(USER, COLLECTION, 30)!.error, 'boom');
  });

  it('shows an import only to the account that started it', () => {
    startImport(USER, COLLECTION, 0);
    assert.equal(importStateFor(OTHER, COLLECTION, 10), null);
  });

  it('reports a stale run as failed and forgets old results', () => {
    const job = startImport(USER, COLLECTION, 0)!;
    assert.equal(importStateFor(USER, COLLECTION, STALE_AFTER_MS + 1)!.status, 'error');
    recordImportEvent(job, 'import_finished', { count: 1 }, 10);
    assert.equal(importStateFor(USER, COLLECTION, 10 + KEEP_FINISHED_MS + 1), null);
  });

  it('forgets an import its handler turned down', () => {
    const job = startImport(USER, COLLECTION, 0)!;
    dropImport(job);
    assert.equal(runningImport(COLLECTION, 10), null);
  });
});

describe('trackImport middleware', () => {
  beforeEach(() => resetImportJobs());

  function fakeIo() {
    const sent: any[] = [];
    const io = {
      emit(event: string, data: any) { sent.push({ to: '*', event, data }); },
      to(room: string) { return { emit: (event: string, data: any) => sent.push({ to: room, event, data }) }; }
    };
    return { io, sent };
  }

  function fakeRes() {
    const listeners: Record<string, () => void> = {};
    const res: any = {
      statusCode: 200,
      locals: { activeCollectionId: COLLECTION },
      body: undefined,
      status(code: number) { res.statusCode = code; return res; },
      json(body: any) { res.body = body; return res; },
      on(event: string, fn: () => void) { listeners[event] = fn; },
      finish() { listeners.finish?.(); }
    };
    return res;
  }

  it('sends import events to the starter only, records them and tags the 202 with the job', () => {
    const { io, sent } = fakeIo();
    const req: any = { user: { _id: USER }, io, t: (k: string) => k };
    const res = fakeRes();
    let called = false;
    trackImport(req, res, () => { called = true; });
    assert.ok(called);

    res.status(202).json({ success: true });
    const jobId = res.body.jobId;
    assert.ok(jobId);

    req.io.emit('import_progress', { current: 1, total: 2 });
    req.io.emit('refresh_all_progress', { current: 1 });
    assert.deepEqual(sent[0], { to: `user:${USER}`, event: 'import_progress', data: { current: 1, total: 2, jobId } });
    assert.equal(sent[1].to, '*');
    assert.equal(importStateFor(USER, COLLECTION)!.current, 1);
  });

  it('answers 409 while the collection is busy, and frees it when the handler refuses', () => {
    const { io } = fakeIo();
    const first = fakeRes();
    trackImport({ user: { _id: USER }, io, t: (k: string) => k }, first, () => {});

    const second = fakeRes();
    let called = false;
    trackImport({ user: { _id: OTHER }, io, t: (k: string) => k }, second, () => { called = true; });
    assert.equal(called, false);
    assert.equal(second.statusCode, 409);

    first.status(400).json({ error: 'bad url' });
    first.finish();
    assert.equal(runningImport(COLLECTION), null);
  });
});
