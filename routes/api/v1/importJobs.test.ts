import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_JOB_TTL_MS, clearImportJobs, createImportJob, failImportJob, findRunningJob,
  finishImportJob, getImportJob, setImportProgress, scopeKeyFor
} from '../../../utils/importJobs';
import { startImportJob } from '../../../utils/apiImportRunner';

beforeEach(() => clearImportJobs());

function fakeReqRes() {
  const emitted: any[] = [];
  const req: any = {
    user: { _id: 'u1' },
    body: {},
    t: (key: string) => key,
    io: { emit: (event: string, payload: any) => { emitted.push({ event, payload }); } }
  };
  const res: any = { locals: {} };
  return { req, res, emitted };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('import job registry', () => {
  test('createImportJob stores a running job with a scope key', () => {
    const job = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin', pluginId: 'music' });
    assert.equal(job.status, 'running');
    assert.equal(job.scopeKey, 'collection:abc');
    assert.equal(job.pluginId, 'music');
    assert.equal(getImportJob(job.id)?.id, job.id);
  });

  test('scopeKeyFor marks an instance job', () => {
    const job = createImportJob({ kind: 'instance_backup', collectionId: null, userId: 'u1', minRole: 'admin' });
    assert.equal(job.scopeKey, 'instance');
    assert.equal(job.collectionId, null);
    assert.equal(scopeKeyFor(null), 'instance');
  });

  test('findRunningJob only returns a running job for the same scope', () => {
    const first = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    assert.equal(findRunningJob('collection:abc')?.id, first.id);
    assert.equal(findRunningJob('collection:xyz'), undefined);
    finishImportJob(first, { imported: 1 });
    assert.equal(findRunningJob('collection:abc'), undefined);
  });

  test('progress updates then finish records a normalized result', () => {
    const job = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    setImportProgress(job, 3, 10);
    assert.equal(job.current, 3);
    assert.equal(job.total, 10);
    finishImportJob(job, { imported: 8 });
    assert.equal(job.status, 'finished');
    assert.deepEqual(job.result, { imported: 8 });
    assert.equal(job.current, 10, 'finishing snaps current to total');
  });

  test('fail records the message and findRunningJob stops matching', () => {
    const job = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    failImportJob(job, 'boom');
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'boom');
    assert.equal(findRunningJob('collection:abc'), undefined);
  });

  test('a terminal job ignores later transitions', () => {
    const job = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    finishImportJob(job, { imported: 2 });
    failImportJob(job, 'late');
    setImportProgress(job, 99, 99);
    assert.equal(job.status, 'finished');
    assert.equal(job.error, null);
    assert.equal(job.current, 0, 'finish leaves current untouched when total is 0');
  });

  test('getImportJob returns the same object reference handed out', () => {
    const job = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    assert.equal(getImportJob(job.id), job);
  });

  test('an expired job is dropped, and is no longer found as running', () => {
    const job = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    job.updatedAt = new Date(Date.now() - IMPORT_JOB_TTL_MS - 1000);
    assert.equal(getImportJob(job.id), undefined);
    assert.equal(findRunningJob('collection:abc'), undefined);
  });
});

describe('import runner', () => {
  test('a handler emitting finished finalizes the job and forwards the event', async () => {
    const { req, res, emitted } = fakeReqRes();
    const job = createImportJob({ kind: 'importer', collectionId: 'abc', userId: 'u1', minRole: 'editor' });

    startImportJob({
      req, res, job,
      run: async (r: any) => {
        r.io.emit('import_progress', { current: 1, total: 2 });
        r.io.emit('import_finished', { count: 2, updated: 1, failed: 0, unenriched: 0 });
      }
    });
    await tick();

    assert.equal(job.status, 'finished');
    assert.deepEqual(job.result, { count: 2, imported: 2, updated: 1, failed: 0, unenriched: 0 });
    assert.equal(job.current, 2, 'finishing snaps current to total');
    assert.equal(job.total, 2);
    assert.deepEqual(emitted.map(e => e.event), ['import_progress', 'import_finished'],
      'the web socket still receives the events');
  });

  test('a handler that throws marks the job failed', async () => {
    const { req, res } = fakeReqRes();
    const job = createImportJob({ kind: 'csv', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    startImportJob({ req, res, job, run: async () => { throw new Error('kaboom'); } });
    await tick();
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'kaboom');
  });

  test('a handler that resolves without emitting finishes the job', async () => {
    const { req, res } = fakeReqRes();
    const job = createImportJob({ kind: 'instance_backup', collectionId: null, userId: 'u1', minRole: 'admin' });
    startImportJob({ req, res, job, run: async () => {} });
    await tick();
    assert.equal(job.status, 'finished');
    assert.equal(job.result, null);
  });

  test('a captured error response fails the job', async () => {
    const { req, res } = fakeReqRes();
    const job = createImportJob({ kind: 'collection_backup', collectionId: 'abc', userId: 'u1', minRole: 'admin' });
    startImportJob({
      req, res, job,
      run: async (_r: any, s: any) => { s.status(400).json({ error: 'Backup file missing required fields' }); }
    });
    await tick();
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'Backup file missing required fields');
  });

  test('the stubbed response lets the handler write without touching the real response', async () => {
    const { req, res } = fakeReqRes();
    const job = createImportJob({ kind: 'importer', collectionId: 'abc', userId: 'u1', minRole: 'editor' });
    let capturedBody: any = null;
    startImportJob({
      req, res, job,
      run: async (_r: any, s: any) => {
        s.status(202).json({ success: true, message: 'Import started' });
        capturedBody = { status: 'still running' };
      }
    });
    await tick();
    assert.equal(res.headersSent, undefined, 'the real response is never written');
    assert.deepEqual(capturedBody, { status: 'still running' });
    assert.equal(job.status, 'finished');
    assert.deepEqual(job.result, { success: true, message: 'Import started' });
  });
});
