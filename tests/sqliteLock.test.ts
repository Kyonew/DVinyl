import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDatabase, DatabaseInUseError, openDatabase, Table } from '../core/db/sqlite/database';

// The tables are served from memory, so two processes on one file would undo each
// other's writes. These run the other process for real: a lock is a matter between
// processes, and one process cannot stand in for two.

const root = path.join(__dirname, '..');

function tempFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvinyl-lock-'));
  return path.join(dir, `${name}.sqlite`);
}

/** Runs `code` in another Node process, with better-sqlite3 as `D` and the file as `file`. */
function runOther(file: string, code: string) {
  const script = `const D = require('better-sqlite3'); const file = ${JSON.stringify(file)};\n${code}`;
  return spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
}

test('while DVinyl has the file open, another process can neither read nor write it', () => {
  const file = tempFile('held');
  openDatabase(file);
  try {
    new Table('things').insert({ _id: 'a', name: 'kept' });
    const read = runOther(file, `
      try { new D(file, { timeout: 200 }).prepare('SELECT count(*) AS n FROM things').get(); console.log('read'); }
      catch (err) { console.log(err.code); }`);
    assert.equal(read.stdout.trim(), 'SQLITE_BUSY');
  } finally {
    closeDatabase();
  }

  const after = runOther(file, `console.log(String(new D(file).prepare('SELECT count(*) AS n FROM things').get().n));`);
  assert.equal(after.stdout.trim(), '1', 'closing releases the file');
});

test('opening a file another process holds is refused with DatabaseInUseError, and works once it is gone', async () => {
  const file = tempFile('taken');
  const holder = spawn(process.execPath, ['-e', `
    const D = require('better-sqlite3');
    const db = new D(${JSON.stringify(file)});
    db.pragma('locking_mode = EXCLUSIVE');
    db.pragma('journal_mode = WAL');
    db.exec('BEGIN EXCLUSIVE; COMMIT');
    console.log('ready');
    setInterval(() => {}, 1000);`], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise<void>((resolve, reject) => {
      holder.stdout!.once('data', () => resolve());
      holder.once('exit', code => reject(new Error(`holder exited (${code})`)));
    });
    assert.throws(() => openDatabase(file, { busyTimeout: 100 }), DatabaseInUseError);
  } finally {
    holder.kill('SIGKILL');
    await new Promise(resolve => holder.once('exit', resolve));
  }

  // Killed outright, the holder still released the file.
  openDatabase(file, { busyTimeout: 100 });
  closeDatabase();
});

test('what a process wrote before dying is read back under the lock', () => {
  const file = tempFile('recovered');
  // Written as a version without the lock would, and killed before it could fold its
  // log into the file: the records are only in the -wal file left behind.
  runOther(file, `
    const db = new D(file);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE things (id TEXT PRIMARY KEY, part TEXT, doc TEXT NOT NULL)');
    db.prepare('INSERT INTO things (id, part, doc) VALUES (?, ?, ?)').run('a', null, JSON.stringify({ _id: 'a', name: 'survivor' }));
    process.kill(process.pid, 'SIGKILL');`);
  assert.ok(fs.existsSync(`${file}-wal`), 'the write is left in the -wal file');

  openDatabase(file);
  try {
    assert.equal(new Table('things').get('a')?.name, 'survivor');
  } finally {
    closeDatabase();
  }
});
