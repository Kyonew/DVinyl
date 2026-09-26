import crypto from 'crypto';

/**
 * In-memory registry of running and recently finished imports.
 *
 * A mobile client cannot consume the socket.io progress the web admin UI listens to,
 * so an import started over /api/v1 answers with a job id the client polls. State is
 * deliberately not persisted: the import itself runs in this process, so a restart
 * loses both, and a record of a job whose work is gone would only mislead.
 */

export type ImportJobKind = 'csv' | 'importer' | 'collection_backup' | 'instance_backup';
export type ImportJobStatus = 'running' | 'finished' | 'failed';
export type ImportJobRole = 'admin' | 'editor';

export interface ImportJobResult {
  imported?: number;
  updated?: number;
  failed?: number;
  unenriched?: number;
  [key: string]: any;
}

export interface ImportJob {
  id: string;
  kind: ImportJobKind;
  /** 'instance' or `collection:<id>`; one running import is allowed per scope. */
  scopeKey: string;
  collectionId: string | null;
  userId: string;
  /** The collection role required to poll this job. */
  minRole: ImportJobRole;
  importerId: string | null;
  pluginId: string | null;
  status: ImportJobStatus;
  current: number;
  total: number;
  result: ImportJobResult | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateImportJobInput {
  kind: ImportJobKind;
  collectionId?: any;
  userId: any;
  minRole: ImportJobRole;
  importerId?: string | null;
  pluginId?: string | null;
}

/** How long a terminal (finished/failed) job stays pollable, measured from its last update. */
export const IMPORT_JOB_TTL_MS = 60 * 60 * 1000;

const jobs = new Map<string, ImportJob>();

export function scopeKeyFor(collectionId?: any): string {
  return collectionId ? `collection:${String(collectionId)}` : 'instance';
}

function isExpired(job: ImportJob, now: number): boolean {
  // A running job is never reclaimed: the backup importers emit no progress, so a long
  // destructive restore would otherwise be swept mid-flight, freeing the one-import-per-scope
  // guard and letting a second restore start.
  if (job.status === 'running') return false;
  return now - job.updatedAt.getTime() > IMPORT_JOB_TTL_MS;
}

export function createImportJob(input: CreateImportJobInput): ImportJob {
  const now = new Date();
  const job: ImportJob = {
    id: crypto.randomBytes(12).toString('hex'),
    kind: input.kind,
    scopeKey: scopeKeyFor(input.collectionId),
    collectionId: input.collectionId ? String(input.collectionId) : null,
    userId: String(input.userId),
    minRole: input.minRole,
    importerId: input.importerId ?? null,
    pluginId: input.pluginId ?? null,
    status: 'running',
    current: 0,
    total: 0,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
  jobs.set(job.id, job);
  return job;
}

/** Returns a live job, dropping it first when it has outlived its TTL. */
export function getImportJob(id: string): ImportJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (isExpired(job, Date.now())) {
    jobs.delete(id);
    return undefined;
  }
  return job;
}

export function findRunningJob(scopeKey: string): ImportJob | undefined {
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

function touch(job: ImportJob): void {
  job.updatedAt = new Date();
}

export function setImportProgress(job: ImportJob, current: number, total: number): void {
  if (job.status !== 'running') return;
  if (Number.isFinite(current)) job.current = current;
  if (Number.isFinite(total)) job.total = total;
  touch(job);
}

export function finishImportJob(job: ImportJob, result: ImportJobResult | null = null): void {
  if (job.status !== 'running') return;
  job.status = 'finished';
  job.result = result;
  if (job.total > 0) job.current = job.total;
  touch(job);
}

export function failImportJob(job: ImportJob, error: string): void {
  if (job.status !== 'running') return;
  job.status = 'failed';
  job.error = error;
  touch(job);
}

/** Test seam. */
export function clearImportJobs(): void {
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
