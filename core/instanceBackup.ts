import path from 'path';
import { promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { SQLITE_PATH } from '../config/constants';
import { persistsWithContainer } from '../config/dataVolume';
import { writeBackupArchive } from './backupArchive';
import { db } from './db';
import { all, eq, idOf } from './db/query';
import { jsonStream, StreamedDocument } from './jsonStream';
import { notify } from './notify';

const pkg = require('../package.json');

/**
 * The whole-instance backup, downloaded from the instance page or written on a schedule to
 * a folder on the server. Off until an admin turns it on. A file only takes its final name
 * once complete, so whatever carries the folder elsewhere never picks up half a backup.
 */

export const BACKUP_FREQUENCIES = { daily: 24 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000 } as const;
export const BACKUP_FORMATS = ['zip', 'json'] as const;
export const MIN_BACKUPS_KEPT = 1;
export const MAX_BACKUPS_KEPT = 90;
const DEFAULT_BACKUPS_KEPT = 7;

// How often the schedule is looked at, which is also how late a backup can start.
export const BACKUP_CHECK_INTERVAL_MS = 15 * 60 * 1000;
// A failed attempt waits this long before the next one, rather than a whole period.
const RETRY_AFTER_MS = 3600 * 1000;

// Only what this file writes is ever listed, served or removed from the folder, which may
// well hold other things when it is a share.
const BACKUP_FILE = /^dvinyl_instance_\d{4}-\d{2}-\d{2}_\d{6}\.(zip|json)$/;
const PARTIAL_SUFFIX = '.partial';

export const DEFAULT_BACKUP_FOLDER = path.resolve(path.dirname(SQLITE_PATH), 'backups');
const PUBLIC_FOLDER = path.resolve(__dirname, '..', 'public');

export const isBackupFileName = (name: unknown): name is string => typeof name === 'string' && BACKUP_FILE.test(name);

/** The folder in use: BACKUP_DIR wins over what was chosen on the page, then the default. */
export const backupFolderFrom = (chosen: unknown): string =>
  path.resolve(process.env.BACKUP_DIR || String(chosen || '') || DEFAULT_BACKUP_FOLDER);

/**
 * Whether the web server hands out what is in `folder`: a backup holds every account with
 * its password hash, and anyone could download it from there. Links are followed, up to
 * the part of the path that exists.
 */
export async function isServedFolder(folder: string): Promise<boolean> {
  const real = async (target: string): Promise<string> => {
    try {
      return await fs.realpath(target);
    } catch {
      const parent = path.dirname(target);
      return parent === target ? target : path.join(await real(parent), path.basename(target));
    }
  };
  const [resolved, served] = await Promise.all([real(path.resolve(folder)), real(PUBLIC_FOLDER)]);
  return resolved === served || resolved.startsWith(served + path.sep);
}

/** Why a folder chosen on the page cannot be used, as a message key, or null when it can. */
export async function backupFolderIssue(chosen: string): Promise<string | null> {
  if (!chosen) return null;
  if (!path.isAbsolute(chosen)) return 'error_backup_folder_absolute';
  if (await isServedFolder(chosen)) return 'error_backup_folder_public';
  const probe = path.join(chosen, `.dvinyl_write_test_${process.pid}`);
  try {
    await fs.mkdir(chosen, { recursive: true });
    await fs.writeFile(probe, '');
    await fs.unlink(probe);
    return null;
  } catch {
    return 'error_backup_folder_unwritable';
  }
}

// The items are given as a way to go through them (see core/jsonStream.ts): the export
// writes them one at a time instead of holding the whole collection, which on a large one
// is more than a small host has to spare.
export async function buildInstanceBackup(): Promise<StreamedDocument> {
  return {
    users: await db.users.find(all()),
    albums: () => db.items.each(all()),
    logs: await db.loginLogs.find(all()),
    settings: await db.settings.find(all()),
    collections: await db.collections.find(all()),
    furniture: await db.furniture.find(all()),
    lists: await db.lists.find(all()),
    requests: await db.requests.find(all()),
    requestTypes: await db.requestTypes.find(all()),
    customPlugins: await db.customPlugins.find(all()),
    priceHistory: await db.priceHistory.find(all()),
    instanceSettings: await db.instanceSettings.findOne(eq('key', 'instance')),
    metadata: {
      version: pkg.version,
      date: new Date()
    }
  };
}

const keptCount = (value: unknown): number => {
  const count = Number.parseInt(String(value), 10);
  if (!Number.isFinite(count)) return DEFAULT_BACKUPS_KEPT;
  return Math.min(MAX_BACKUPS_KEPT, Math.max(MIN_BACKUPS_KEPT, count));
};

/** The choices of a stored or submitted schedule, anything unknown back to its default. */
export function backupChoices(values: any) {
  return {
    enabled: values?.enabled === true,
    frequency: (values?.frequency === 'weekly' ? 'weekly' : 'daily') as keyof typeof BACKUP_FREQUENCIES,
    format: (values?.format === 'json' ? 'json' : 'zip') as typeof BACKUP_FORMATS[number],
    keep: keptCount(values?.keep ?? DEFAULT_BACKUPS_KEPT)
  };
}

/**
 * Whether the schedule calls for a backup now. Counted from the last one that worked, so
 * an instance that was off catches up when it starts again. The check interval comes off
 * the period, or each backup would start a little later than the one before.
 */
export function isBackupDue(stored: any, now = new Date()): boolean {
  const { enabled, frequency } = backupChoices(stored);
  if (!enabled) return false;
  const since = (date: unknown) => now.getTime() - new Date(date as any).getTime();
  if (stored.lastAttemptAt && since(stored.lastAttemptAt) < RETRY_AFTER_MS) return false;
  return !stored.lastSuccessAt || since(stored.lastSuccessAt) >= BACKUP_FREQUENCIES[frequency] - BACKUP_CHECK_INTERVAL_MS;
}

async function stored(): Promise<any> {
  const doc = await db.instanceSettings.findOne(eq('key', 'instance'), { fields: ['backups'] });
  return doc?.backups || {};
}

async function record(values: Record<string, unknown>): Promise<void> {
  const set = Object.fromEntries(Object.entries(values).map(([key, value]) => [`backups.${key}`, value]));
  await db.instanceSettings.updateOne(eq('key', 'instance'), { set }, { upsert: true });
}

/**
 * Saves the schedule, unless the folder cannot be used: nothing changes then, and the
 * message key saying why comes back. BACKUP_DIR leaves the chosen folder as it was.
 */
export async function saveBackupChoices(values: any): Promise<string | null> {
  if (process.env.BACKUP_DIR) {
    await record(backupChoices(values));
    return null;
  }
  const folder = String(values?.folder || '').trim();
  const issue = await backupFolderIssue(folder);
  if (issue) return issue;
  await record({ ...backupChoices(values), folder });
  return null;
}

/** The backups in the folder, latest first. A folder not made yet simply holds none. */
async function listBackups(folder: string): Promise<{ name: string; size: number; date: Date }[]> {
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  const backups = [];
  for (const name of names.filter(entry => BACKUP_FILE.test(entry)).sort().reverse()) {
    try {
      const { size, mtime } = await fs.stat(path.join(folder, name));
      backups.push({ name, size, date: mtime });
    } catch { /* gone in the meantime */ }
  }
  return backups;
}

/** Where a backup of the folder sits, or null for any name this file did not write. */
export async function backupFile(name: unknown): Promise<string | null> {
  return isBackupFileName(name) ? path.join(backupFolderFrom((await stored()).folder), name) : null;
}

let running = false;

/** What the instance admin page shows. */
export async function backupStatus() {
  const backups = await stored();
  const folder = backupFolderFrom(backups.folder);
  return {
    ...backupChoices(backups),
    running,
    folder,
    chosenFolder: backups.folder || '',
    folderLocked: Boolean(process.env.BACKUP_DIR),
    defaultFolder: DEFAULT_BACKUP_FOLDER,
    folderPersists: persistsWithContainer(folder),
    lastSuccessAt: backups.lastSuccessAt || null,
    lastSize: backups.lastSize || 0,
    lastAttemptAt: backups.lastAttemptAt || null,
    lastError: backups.lastError || '',
    files: await listBackups(folder)
  };
}

const fileNameFor = (date: Date, format: string): string => {
  const [day, time] = date.toISOString().split('T') as [string, string];
  return `dvinyl_instance_${day}_${time.slice(0, 8).replace(/:/g, '')}.${format}`;
};

async function writeBackup(file: string, data: StreamedDocument, format: string): Promise<void> {
  // Opened first: a folder that cannot be written to is then a plain rejection here, not
  // an error event from a stream nobody listens to yet while the images are looked for.
  const handle = await fs.open(file, 'w');
  const output = handle.createWriteStream();
  try {
    if (format === 'zip') await writeBackupArchive(output, data);
    else await pipeline(jsonStream(data), output);
  } catch (err) {
    output.destroy();
    throw err;
  }
}

async function removeOldBackups(folder: string, keep: number): Promise<void> {
  for (const { name } of (await listBackups(folder)).slice(keep)) {
    await fs.unlink(path.join(folder, name));
  }
  // What an instance stopped in the middle of a backup left behind.
  for (const name of await fs.readdir(folder)) {
    if (name.endsWith(PARTIAL_SUFFIX) && BACKUP_FILE.test(name.slice(0, -PARTIAL_SUFFIX.length))) {
      await fs.unlink(path.join(folder, name));
    }
  }
}

async function reportFailure(err: any, backups: any): Promise<void> {
  const message = String(err?.message || err);
  console.error('[BACKUP] Automatic backup failed:', message);
  await record({ lastError: message, failureNotified: true });
  // Once until one works again. The reason stays on the page: a notification may go
  // through a push service, and this one holds paths of the server.
  if (backups.failureNotified) return;
  const admins = await db.users.find(eq('isAdmin', true), { fields: ['_id'] });
  await notify({
    event: 'instance.backup_failed',
    to: admins.map((u: any) => idOf(u._id)),
    payload: {},
    link: '/admin/instance#backup'
  });
}

/**
 * Writes one backup now, unless one is already being written. Never throws: a failure is
 * kept for the page and told to the admins.
 */
export async function runBackup(): Promise<void> {
  if (running) return;
  running = true;
  let partial = '';
  let backups: any = {};
  try {
    backups = await stored();
    const { format, keep } = backupChoices(backups);
    const startedAt = new Date();
    await record({ lastAttemptAt: startedAt });
    const folder = backupFolderFrom(backups.folder);
    // Checked here as well: the folder can also come from BACKUP_DIR or a restored backup.
    if (await isServedFolder(folder)) throw new Error(`${folder} is served by the web server, so backups would be public`);
    await fs.mkdir(folder, { recursive: true });
    const name = fileNameFor(startedAt, format);
    const file = path.join(folder, name);
    partial = file + PARTIAL_SUFFIX;
    await writeBackup(partial, await buildInstanceBackup(), format);
    await fs.rename(partial, file);
    partial = '';
    const { size } = await fs.stat(file);
    await record({ lastSuccessAt: new Date(), lastSize: size, lastError: '', failureNotified: false });
    console.log(`[BACKUP] Automatic backup written: ${file} (${size} bytes)`);
    // The backup is safe by now, so failing to tidy up does not make it a failed one.
    await removeOldBackups(folder, keep).catch((err: any) => console.warn('[BACKUP] Old backups cleanup failed:', err?.message || err));
  } catch (err: any) {
    if (partial) await fs.unlink(partial).catch(() => {});
    await reportFailure(err, backups).catch((reportErr: any) => console.error('[BACKUP] Failure report failed:', reportErr));
  } finally {
    running = false;
  }
}

/** Writes a backup if the schedule calls for one. */
export async function runBackupIfDue(now = new Date()): Promise<void> {
  try {
    if (isBackupDue(await stored(), now)) await runBackup();
  } catch (err: any) {
    console.warn('[BACKUP] Schedule check failed:', err?.message || err);
  }
}
