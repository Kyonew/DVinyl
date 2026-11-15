import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { backupChoices, backupFolderFrom, backupFolderIssue, DEFAULT_BACKUP_FOLDER, isBackupDue, isBackupFileName, isServedFolder } from '../core/instanceBackup';

const HOUR = 3600 * 1000;
const NOW = new Date('2026-11-03T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('automatic backup schedule', () => {
  it('stays quiet until it is turned on', () => {
    assert.equal(isBackupDue({}, NOW), false);
    assert.equal(isBackupDue({ enabled: false, lastSuccessAt: ago(1000 * HOUR) }, NOW), false);
  });

  it('writes the first one straight away', () => {
    assert.equal(isBackupDue({ enabled: true }, NOW), true);
  });

  it('counts from the last backup that worked', () => {
    assert.equal(isBackupDue({ enabled: true, frequency: 'daily', lastSuccessAt: ago(23 * HOUR) }, NOW), false);
    assert.equal(isBackupDue({ enabled: true, frequency: 'daily', lastSuccessAt: ago(24 * HOUR) }, NOW), true);
    assert.equal(isBackupDue({ enabled: true, frequency: 'weekly', lastSuccessAt: ago(100 * HOUR) }, NOW), false);
    assert.equal(isBackupDue({ enabled: true, frequency: 'weekly', lastSuccessAt: ago(168 * HOUR) }, NOW), true);
  });

  it('does not start later each time because of the check interval', () => {
    assert.equal(isBackupDue({ enabled: true, frequency: 'daily', lastSuccessAt: new Date(NOW.getTime() - 24 * HOUR + 10 * 60 * 1000) }, NOW), true);
  });

  it('waits an hour after a failed attempt, not a whole period', () => {
    const failed = { enabled: true, frequency: 'weekly', lastSuccessAt: ago(200 * HOUR) };
    assert.equal(isBackupDue({ ...failed, lastAttemptAt: ago(HOUR / 2) }, NOW), false);
    assert.equal(isBackupDue({ ...failed, lastAttemptAt: ago(HOUR) }, NOW), true);
  });

  it('brings a submitted choice back within what is offered', () => {
    assert.deepEqual(backupChoices({}), { enabled: false, frequency: 'daily', format: 'zip', keep: 7 });
    assert.deepEqual(backupChoices({ enabled: 'on', frequency: 'hourly', format: 'exe', keep: 'many' }), { enabled: false, frequency: 'daily', format: 'zip', keep: 7 });
    assert.equal(backupChoices({ keep: '0' }).keep, 1);
    assert.equal(backupChoices({ keep: '5000' }).keep, 90);
    assert.equal(backupChoices({ frequency: 'weekly', format: 'json', keep: 3 }).frequency, 'weekly');
  });

  it('only names files it wrote', () => {
    assert.equal(isBackupFileName('dvinyl_instance_2026-11-03_120000.zip'), true);
    for (const bad of ['../dvinyl.sqlite', 'notes.txt', 'dvinyl_instance_2026-11-03_120000.zip.partial', '../dvinyl_instance_2026-11-03_120000.zip', undefined, ['a']]) {
      assert.equal(isBackupFileName(bad), false);
    }
  });

  it('takes BACKUP_DIR first, then the chosen folder, then the default', () => {
    const saved = process.env.BACKUP_DIR;
    try {
      delete process.env.BACKUP_DIR;
      assert.equal(backupFolderFrom(''), DEFAULT_BACKUP_FOLDER);
      assert.equal(backupFolderFrom('/mnt/nas'), '/mnt/nas');
      process.env.BACKUP_DIR = '/backups';
      assert.equal(backupFolderFrom('/mnt/nas'), '/backups');
    } finally {
      if (saved === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = saved;
    }
  });

  it('refuses a relative path, a folder the web server hands out, or one it cannot write to', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvinyl-folder-'));
    const publicFolder = path.resolve(__dirname, '..', 'public');
    try {
      assert.equal(await backupFolderIssue(''), null);
      assert.equal(await backupFolderIssue('backups'), 'error_backup_folder_absolute');
      assert.equal(await backupFolderIssue(publicFolder), 'error_backup_folder_public');
      assert.equal(await backupFolderIssue(path.join(publicFolder, 'not', 'made', 'yet')), 'error_backup_folder_public');

      const link = path.join(root, 'link');
      fs.symlinkSync(publicFolder, link);
      assert.equal(await isServedFolder(path.join(link, 'sub')), true, 'a link does not hide it');
      assert.equal(await isServedFolder(`${publicFolder}-other`), false, 'a sibling with a similar name is fine');

      fs.writeFileSync(path.join(root, 'file'), '');
      assert.equal(await backupFolderIssue(path.join(root, 'file', 'sub')), 'error_backup_folder_unwritable');

      const good = path.join(root, 'a', 'b');
      assert.equal(await backupFolderIssue(good), null);
      assert.deepEqual(fs.readdirSync(good), [], 'it is made, and the check leaves nothing in it');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
