import crypto from 'crypto';

/**
 * In-memory registry of running and recently finished metadata refreshes.
 *
 * A mobile client cannot consume the socket.io progress the web admin UI listens to,
 * so a bulk refresh started over /api/v1 answers with a job id the client polls. State
 * is deliberately not persisted: the refresh runs in this process, so a restart loses
 * both, and a record of a job whose work is gone would only mislead.
 */

export type RefreshMode = 'all' | 'missing';
export type RefreshJobStatus = 'running' | 'finished' | 'failed';

export interface RefreshJobResult {
  refreshed: number;
  failed: number;
  total: number;
}

export interface RefreshJob {
  id: string;
  /** 'collection:<id>:refresh:<pluginId>'; one running refresh is allowed per pair. */
  scopeKey: string;
  collectionId: string;
  pluginId: string;
  mode: RefreshMode;
  userId: string;
  status: RefreshJobStatus;
  current: number;
  total: number;
  /** Title shown as "now refreshing", for progress UI; null before the first item. */
  currentTitle: string | null;
  result: RefreshJobResult | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRefreshJobInput {
  collectionId: any;
  pluginId: string;
  mode: RefreshMode;
  userId: any;
}

/** How long a terminal (finished/failed) job stays pollable, measured from its last update. */
export const REFRESH_JOB_TTL_MS = 60 * 60 * 1000;

const jobs = new Map<string, RefreshJob>();

export function refreshScopeKey(collectionId: any, pluginId: string): string {
  return `collection:${String(collectionId)}:refresh:${pluginId}`;
}

function isExpired(job: RefreshJob, now: number): boolean {
  // A running job is never reclaimed: the one-running-per-scope guard would otherwise be
  // freed mid-flight and let a second refresh of the same plugin start.
  if (job.status === 'running') return false;
  return now - job.updatedAt.getTime() > REFRESH_JOB_TTL_MS;
}

export function createRefreshJob(input: CreateRefreshJobInput): RefreshJob {
  const now = new Date();
  const job: RefreshJob = {
    id: crypto.randomBytes(12).toString('hex'),
    scopeKey: refreshScopeKey(input.collectionId, input.pluginId),
    collectionId: String(input.collectionId),
    pluginId: input.pluginId,
    mode: input.mode,
    userId: String(input.userId),
    status: 'running',
    current: 0,
    total: 0,
    currentTitle: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
  jobs.set(job.id, job);
  return job;
}

/** Returns a live job, dropping it first when it has outlived its TTL. */
export function getRefreshJob(id: string): RefreshJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (isExpired(job, Date.now())) {
    jobs.delete(id);
    return undefined;
  }
  return job;
}

export function findRunningRefreshJob(scopeKey: string): RefreshJob | undefined {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.scopeKey !== scopeKey || job.status !== 'running') continue;
    if (isExpired(job, now)) {
      jobs.delete(job.id);
      continue;
    }
    return job;
  }
  return undefined;
}

function touch(job: RefreshJob): void {
  job.updatedAt = new Date();
}

export function setRefreshProgress(job: RefreshJob, current: number, total: number, title: string): void {
  if (job.status !== 'running') return;
  if (Number.isFinite(current)) job.current = current;
  if (Number.isFinite(total)) job.total = total;
  job.currentTitle = title;
  touch(job);
}

export function finishRefreshJob(job: RefreshJob, result: RefreshJobResult): void {
  if (job.status !== 'running') return;
  job.status = 'finished';
  job.result = result;
  if (job.total > 0) job.current = job.total;
  touch(job);
}

export function failRefreshJob(job: RefreshJob, error: string): void {
  if (job.status !== 'running') return;
  job.status = 'failed';
  job.error = error;
  touch(job);
}

/** Test seam. */
export function clearRefreshJobs(): void {
  jobs.clear();
}

// Reclaim expired jobs in a long-lived process. unref() so the timer never keeps the
// process (or the test runner) alive.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (isExpired(job, now)) jobs.delete(id);
  }
}, 10 * 60 * 1000);
sweep.unref?.();
