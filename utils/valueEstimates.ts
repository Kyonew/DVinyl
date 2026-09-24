import crypto from 'crypto';
import Item from '../models/Item';
import PriceHistory from '../models/PriceHistory';
import { registry } from '../core/registry';

export interface ValueEstimateJob {
  id: string;
  collectionId: string;
  userId: string;
  status: 'running' | 'done' | 'error';
  processed: number;
  total: number;
  pricedCount: number;
  failedCount: number;
  value: number;
  minValue: number;
  maxValue: number;
  currency: string;
  saved: boolean;
  error?: string;
  startedAt: Date;
  finishedAt?: Date;
}

const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_JOBS = 200;
const jobs = new Map<string, ValueEstimateJob>();

/** Tests only: drop every job so one test's run cannot leak into the next. */
export function resetValueEstimateJobs(): void {
  jobs.clear();
}

export function getValueEstimateJob(jobId: string): ValueEstimateJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (job.finishedAt && Date.now() - job.finishedAt.getTime() > JOB_TTL_MS) {
    jobs.delete(jobId);
    return undefined;
  }
  return job;
}

function activeJobForCollection(collectionId: string): ValueEstimateJob | undefined {
  for (const job of jobs.values()) {
    if (job.collectionId === collectionId && job.status === 'running') return job;
  }
  return undefined;
}

function evictIfFull(): void {
  if (jobs.size < MAX_JOBS) return;
  let oldest: ValueEstimateJob | undefined;
  for (const job of jobs.values()) {
    if (job.status === 'running') continue;
    if (!oldest || (job.finishedAt ?? job.startedAt) < (oldest.finishedAt ?? oldest.startedAt)) oldest = job;
  }
  if (oldest) jobs.delete(oldest.id);
}

interface EstimateEntry {
  pluginId: string;
  externalId: string;
  quantity: number;
  maxMultiplier: number;
}

/**
 * Every non-wishlist item of an enabled estimate-capable plugin that carries its external
 * id — mirrors the web's /api/collection/ids (which ignores visibility settings). Legacy
 * items with no `kind` belong to the plugin that claims them, same as the listing routes.
 */
async function collectEntries(settings: any, collectionId: any): Promise<EstimateEntry[]> {
  const entries: EstimateEntry[] = [];

  for (const plugin of registry.getEnabled(settings)) {
    if (!plugin.estimatePrice || !plugin.externalIdField) continue;
    const idField = plugin.externalIdField;

    const query: any = {
      collection: collectionId,
      in_wishlist: false,
      [idField]: { $exists: true, $nin: [null, ''] }
    };
    if (plugin.matchesLegacyItems) {
      query.$and = [{ $or: [{ kind: plugin.kind }, { kind: { $exists: false } }] }];
    } else {
      query.kind = plugin.kind;
    }

    const items: any[] = await Item.find(query).lean();
    const action: any = (plugin.collectionActions || []).find((a: any) => a.behavior === 'estimate');
    const maxMultiplier = action?.estimate?.maxMultiplier ?? 1.3;

    for (const item of items) {
      entries.push({
        pluginId: plugin.id,
        externalId: String(item[idField]),
        quantity: item.quantity || 1,
        maxMultiplier
      });
    }
  }

  return entries;
}

async function runJob(job: ValueEstimateJob, entries: EstimateEntry[], collectionId: any): Promise<void> {
  try {
    for (const entry of entries) {
      const plugin = registry.get(entry.pluginId);
      try {
        if (!plugin?.estimatePrice) throw new Error('Price provider unavailable');
        const estimate = await plugin.estimatePrice(entry.externalId, { currency: job.currency });
        if (estimate) {
          const line = estimate.price.value * entry.quantity;
          job.value += line;
          job.minValue += line;
          job.maxValue += line * entry.maxMultiplier;
          job.pricedCount++;
        } else {
          job.failedCount++;
        }
      } catch (err: any) {
        job.failedCount++;
      }
      job.processed++;
      await new Promise(r => setTimeout(r, plugin?.bulkRefreshDelayMs ?? 500));
    }

    // Only a run where at least half the items priced is representative enough to record:
    // a mostly-failed run would otherwise read as "the collection lost value".
    const shouldSave = job.pricedCount > 0 && job.pricedCount >= job.total / 2;
    if (shouldSave) {
      await PriceHistory.create({
        collection: collectionId,
        value: job.value,
        minValue: job.minValue,
        maxValue: job.maxValue,
        currency: job.currency,
        itemCount: job.total
      });
      job.saved = true;
    }
    job.status = 'done';
  } catch (err: any) {
    job.status = 'error';
    job.error = err?.message || 'Estimate failed';
  } finally {
    job.finishedAt = new Date();
  }
}

export async function startValueEstimate(opts: {
  collectionId: any;
  user: any;
  settings: any;
}): Promise<{ job?: ValueEstimateJob; error?: 'running' | 'no_items'; activeJob?: ValueEstimateJob }> {
  const collectionId = String(opts.collectionId);

  const existing = activeJobForCollection(collectionId);
  if (existing) return { error: 'running', activeJob: existing };

  const entries = await collectEntries(opts.settings, opts.collectionId);
  if (entries.length === 0) return { error: 'no_items' };

  const job: ValueEstimateJob = {
    id: crypto.randomBytes(16).toString('hex'),
    collectionId,
    userId: String(opts.user._id),
    status: 'running',
    processed: 0,
    total: entries.length,
    pricedCount: 0,
    failedCount: 0,
    value: 0,
    minValue: 0,
    maxValue: 0,
    currency: opts.user.currency || 'USD',
    saved: false,
    startedAt: new Date()
  };

  evictIfFull();
  jobs.set(job.id, job);

  // Fire and forget, like POST /admin/refresh-all: the response is sent first, then the
  // loop runs. Jobs are process-local and lost on restart (a poll then 404s).
  setImmediate(() => { void runJob(job, entries, opts.collectionId); });

  return { job };
}
