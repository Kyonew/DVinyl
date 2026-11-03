import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { ADMIN, addMusic, exportInstance, login, setupAdmin, titles } from './fixtures';

const backend = backendFor('scheduled_backup');

describe('automatic backups', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvinyl-backups-'));
  const folder = path.join(root, 'backups');

  const backups = () => fs.existsSync(folder) && fs.statSync(folder).isDirectory()
    ? fs.readdirSync(folder).filter(name => name.startsWith('dvinyl_instance_') && !name.endsWith('.partial')).sort()
    : [];
  const until = async (what: string, test: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await test()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`never happened: ${what}`);
  };
  const save = (choices: Record<string, string>) => admin.postForm('/admin/instance/backups', { folder, ...choices });
  // Files are named to the second, so the next one has to start in another.
  const runNow = async () => {
    const before = backups();
    await new Promise(resolve => setTimeout(resolve, 1100));
    const reply = await admin.postForm('/admin/instance/backups/run', {});
    assert.equal(reply.location, '/admin/instance?msg=backup_started#backup');
    await until('a new backup', () => backups().some(name => !before.includes(name)));
    await until('its bookkeeping', async () => !(await instancePage()).includes('A backup is running'));
  };
  const instancePage = async () => (await admin.get('/admin/instance')).text;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await addMusic(admin, { title: 'Kept Safe', artist: 'One' });
  });
  after(async () => {
    await app?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes nothing until it is turned on, then a first backup at once', async () => {
    assert.deepEqual(backups(), []);
    assert.match(await instancePage(), /No backup yet\./);

    for (const [choice, message] of [['relative/path', 'absolute'], [path.join(root, 'taken', 'sub'), 'unwritable']] as const) {
      fs.writeFileSync(path.join(root, 'taken'), '');
      const refused = await save({ folder: choice, enabled: 'on' });
      assert.equal(refused.location, `/admin/instance?msg=error_backup_folder_${message}#backup`);
    }
    assert.doesNotMatch(await instancePage(), /name="enabled" checked/, 'a refused folder saves nothing');

    const reply = await save({ enabled: 'on', frequency: 'weekly', format: 'json', keep: '2' });
    assert.equal(reply.location, '/admin/instance?msg=saved#backup');
    await until('the first backup', () => backups().length === 1);
    assert.match(backups()[0]!, /^dvinyl_instance_\d{4}-\d{2}-\d{2}_\d{6}\.json$/);
    await until('its bookkeeping', async () => /Last backup: /.test(await instancePage()));

    const page = await instancePage();
    assert.ok(page.includes(folder), 'the page says where they go');
    assert.ok(page.includes(backups()[0]!), 'and lists them');
  });

  it('does not write another one before the next is due', async () => {
    await save({ enabled: 'on', frequency: 'weekly', format: 'json', keep: '2' });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(backups().length, 1);
  });

  it('serves a backup to an instance admin only, and nothing else of the folder', async () => {
    const name = backups()[0]!;
    const reply = await admin.get(`/admin/instance/backups/${name}`);
    assert.equal(reply.status, 200);
    const dump = reply.json();
    assert.deepEqual(titles(dump), ['Kept Safe']);
    assert.equal(dump.users[0].username, ADMIN.username);

    fs.writeFileSync(path.join(folder, 'notes.txt'), 'mine');
    assert.equal((await admin.get('/admin/instance/backups/notes.txt')).status, 404);
    assert.equal((await admin.get('/admin/instance/backups/..%2F..%2Fdvinyl.sqlite')).status, 404);
    assert.notEqual((await app.client().get(`/admin/instance/backups/${name}`)).status, 200);

    const page = await admin.postForm('/admin/members/create', { username: 'plain', email: 'plain@example.test', role: 'viewer' });
    const password = page.text.match(/<code class="text-xl[^"]*">([^<]+)<\/code>/)![1]!
      .replace(/&(amp|lt|gt|#34|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', '#34': '"', '#39': "'" } as Record<string, string>)[e]!);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const member = await login(app, 'plain', password);
    assert.notEqual((await member.get(`/admin/instance/backups/${name}`)).status, 200);
    assert.notEqual((await member.postForm('/admin/instance/backups/run', {})).location, '/admin/instance?msg=backup_started#backup');
  });

  it('keeps the latest ones only, and leaves other files of the folder alone', async () => {
    const leftover = path.join(folder, 'dvinyl_instance_2020-01-01_000000.zip.partial');
    fs.writeFileSync(leftover, 'half a backup');
    await runNow();
    const first = backups();
    assert.equal(first.length, 2);
    await runNow();
    assert.equal(backups().length, 2);
    assert.equal(backups()[0], first[1], 'the oldest went');
    assert.ok(fs.existsSync(path.join(folder, 'notes.txt')));
    assert.ok(!fs.existsSync(leftover), 'what an interrupted backup left is cleared');
  });

  it('tells the admins once when it fails, and says why on the page, until one works', async () => {
    const aside = `${folder}.aside`;
    fs.renameSync(folder, aside);
    fs.writeFileSync(folder, 'not a folder');
    const inbox = async () => (await admin.get('/notifications')).text;
    const failures = async () => (await inbox()).match(/The automatic backup failed/g)?.length || 0;

    await admin.postForm('/admin/instance/backups/run', {});
    await until('the failure on the page', async () => /The last attempt failed/.test(await instancePage()));
    await until('the notification', async () => await failures() === 1);

    await admin.postForm('/admin/instance/backups/run', {});
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await failures(), 1, 'once for a run of failures');

    fs.rmSync(folder);
    fs.renameSync(aside, folder);
    await runNow();
    assert.doesNotMatch(await instancePage(), /The last attempt failed/);
  });

  it('writes an archive that restores the instance', async () => {
    await save({ enabled: 'on', frequency: 'weekly', format: 'zip', keep: '2' });
    await runNow();
    const archive = backups().find(name => name.endsWith('.zip'))!;
    assert.ok(archive);
    await addMusic(admin, { title: 'Added Later', artist: 'Two' });
    assert.ok(titles(await exportInstance(admin)).includes('Added Later'));

    const form = new FormData();
    form.append('backup', new Blob([fs.readFileSync(path.join(folder, archive))]), archive);
    const reply = await admin.postMultipart('/backup/import-archive', form);
    assert.equal(reply.status, 200, reply.text);

    const restored = await login(app, ADMIN.email, ADMIN.password);
    assert.deepEqual(titles(await exportInstance(restored)), ['Kept Safe']);
  });
});

describe('automatic backups with BACKUP_DIR', { skip: !backendFor('scheduled_backup_env') }, () => {
  let app: App;
  let admin: Client;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvinyl-backups-env-'));
  const folder = path.join(root, 'fixed');

  before(async () => {
    app = await startApp(backendFor('scheduled_backup_env')!, { BACKUP_DIR: folder });
    admin = await setupAdmin(app);
  });
  after(async () => {
    await app?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('locks the folder to it, whatever the form sends', async () => {
    const page = (await admin.get('/admin/instance')).text;
    assert.match(page, /Set by BACKUP_DIR on the server\./);
    assert.match(page, /name="folder"[^>]*disabled/);
    assert.ok(page.includes(`value="${folder}"`));

    const other = path.join(root, 'other');
    const reply = await admin.postForm('/admin/instance/backups', { folder: other, enabled: 'on' });
    assert.equal(reply.location, '/admin/instance?msg=saved#backup');
    for (let i = 0; i < 100 && !fs.existsSync(folder); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(fs.existsSync(folder));
    assert.ok(!fs.existsSync(other));
  });
});

describe('automatic backups pointed at a public folder', { skip: !backendFor('scheduled_backup_public') }, () => {
  it('writes nothing there, even when the server sets it, and says so', async () => {
    const app = await startApp(backendFor('scheduled_backup_public')!, { BACKUP_DIR: 'public/backups' });
    try {
      const admin = await setupAdmin(app);
      await admin.postForm('/admin/instance/backups/run', {});
      let page = '';
      for (let i = 0; i < 100 && !page.includes('The last attempt failed'); i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        page = (await admin.get('/admin/instance')).text;
      }
      assert.match(page, /The last attempt failed/);
      assert.match(page, /served by the web server/);
      assert.ok(!fs.existsSync(path.join(app.root, 'public', 'backups')));
    } finally {
      await app.stop();
    }
  });
});
