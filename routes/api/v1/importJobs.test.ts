import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_JOB_TTL_MS, clearImportJobs, createImportJob, failImportJob, findRunningJob,
  finishImportJob, getImportJob, setImportProgress, scopeKeyFor
} from '../../../utils/importJobs';

beforeEach(() => clearImportJobs());

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
