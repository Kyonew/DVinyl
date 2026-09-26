import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_JOB_TTL_MS, clearRefreshJobs, createRefreshJob, failRefreshJob,
  findRunningRefreshJob, finishRefreshJob, getRefreshJob, refreshScopeKey, setRefreshProgress
} from '../../../utils/refreshJobs';

beforeEach(() => clearRefreshJobs());

describe('refresh job registry', () => {
  test('createRefreshJob stores a running job with a collection+plugin scope', () => {
    const job = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'all', userId: 'u1' });
    assert.equal(job.status, 'running');
    assert.equal(job.scopeKey, 'collection:abc:refresh:music');
    assert.equal(job.collectionId, 'abc');
    assert.equal(job.pluginId, 'music');
    assert.equal(job.mode, 'all');
    assert.equal(job.currentTitle, null);
    assert.equal(getRefreshJob(job.id), job);
  });

  test('findRunningRefreshJob only matches the same collection and plugin', () => {
    const first = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'all', userId: 'u1' });
    assert.equal(findRunningRefreshJob(refreshScopeKey('abc', 'music')), first);
    assert.equal(findRunningRefreshJob(refreshScopeKey('abc', 'books')), undefined);
    assert.equal(findRunningRefreshJob(refreshScopeKey('xyz', 'music')), undefined);
    finishRefreshJob(first, { refreshed: 1, failed: 0, total: 1 });
    assert.equal(findRunningRefreshJob(refreshScopeKey('abc', 'music')), undefined);
  });

  test('progress updates then finish records the result and snaps current to total', () => {
    const job = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'missing', userId: 'u1' });
    setRefreshProgress(job, 3, 10, 'Ann - Album');
    assert.equal(job.current, 3);
    assert.equal(job.total, 10);
    assert.equal(job.currentTitle, 'Ann - Album');
    finishRefreshJob(job, { refreshed: 8, failed: 2, total: 10 });
    assert.equal(job.status, 'finished');
    assert.deepEqual(job.result, { refreshed: 8, failed: 2, total: 10 });
    assert.equal(job.current, 10, 'finishing snaps current to total');
  });

  test('finish leaves current at 0 when the run had no items', () => {
    const job = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'all', userId: 'u1' });
    finishRefreshJob(job, { refreshed: 0, failed: 0, total: 0 });
    assert.equal(job.current, 0);
    assert.deepEqual(job.result, { refreshed: 0, failed: 0, total: 0 });
  });

  test('fail records the message and stops matching as running', () => {
    const job = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'all', userId: 'u1' });
    failRefreshJob(job, 'boom');
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'boom');
    assert.equal(findRunningRefreshJob(refreshScopeKey('abc', 'music')), undefined);
  });

  test('a terminal job ignores later transitions', () => {
    const job = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'all', userId: 'u1' });
    finishRefreshJob(job, { refreshed: 2, failed: 0, total: 2 });
    failRefreshJob(job, 'late');
    setRefreshProgress(job, 99, 99, 'late');
    assert.equal(job.status, 'finished');
    assert.equal(job.error, null);
  });

  test('a running job past the TTL is retained and still guards its scope', () => {
    const job = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'all', userId: 'u1' });
    job.updatedAt = new Date(Date.now() - REFRESH_JOB_TTL_MS - 1000);
    assert.equal(getRefreshJob(job.id), job);
    assert.equal(findRunningRefreshJob(refreshScopeKey('abc', 'music')), job);
  });

  test('a terminal job past the TTL is dropped', () => {
    const job = createRefreshJob({ collectionId: 'abc', pluginId: 'music', mode: 'all', userId: 'u1' });
    finishRefreshJob(job, { refreshed: 1, failed: 0, total: 1 });
    job.updatedAt = new Date(Date.now() - REFRESH_JOB_TTL_MS - 1000);
    assert.equal(getRefreshJob(job.id), undefined);
    assert.equal(findRunningRefreshJob(refreshScopeKey('abc', 'music')), undefined);
  });
});
