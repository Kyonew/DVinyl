import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { ADMIN, addMusic, enableModules, login, setupAdmin } from './fixtures';

const backend = backendFor('notices');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('notices', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let bob: Client;
  let github: http.Server;
  let releaseAsked = 0;

  const inbox = async (client: Client) => (await client.get('/notifications')).text;
  // Told in the background, so the page that did it answers before the line is written.
  const inboxWith = async (client: Client, pattern: RegExp) => {
    for (const deadline = Date.now() + 2000; ;) {
      const text = await inbox(client);
      if (pattern.test(text) || Date.now() > deadline) return text;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const member = async (username: string) => {
    const reply = await admin.postForm('/admin/members/create', { username, email: `${username}@example.test`, role: 'viewer' });
    const password = reply.text.match(/<code class="text-xl[^"]*">([^<]+)<\/code>/)![1]!
      .replace(/&(amp|lt|gt|#34|#39);/g, (_, entity) =>
        ({ amp: '&', lt: '<', gt: '>', '#34': '"', '#39': "'" } as Record<string, string>)[entity]!);
    await new Promise(resolve => setTimeout(resolve, 1100));
    return login(app, `${username}@example.test`, password);
  };

  before(async () => {
    // GitHub, as far as the instance can tell.
    github = http.createServer((_req, res) => {
      releaseAsked++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://github.com/Kyonew/DVinyl/releases/tag/v99.0.0' }));
    });
    await new Promise<void>(resolve => github.listen(0, '127.0.0.1', resolve));
    const port = (github.address() as AddressInfo).port;
    app = await startApp(backend!, { UPDATE_CHECK_URL: `http://127.0.0.1:${port}/` });
    admin = await setupAdmin(app);
    bob = await member('bob');
  });
  after(async () => {
    await app?.stop();
    await new Promise(resolve => github?.close(resolve));
  });

  it('warns an account of a sign-in from a browser it has never signed in from', async () => {
    await login(app, ADMIN.email, ADMIN.password);
    assert.doesNotMatch(await inbox(admin), /New sign-in/, 'the browser it always uses');

    const phone = app.client();
    phone.userAgent = IPHONE;
    assert.equal((await phone.postJson('/login', { email: ADMIN.email, password: ADMIN.password })).status, 200);
    assert.match(await inboxWith(admin, /New sign-in/), /New sign-in to your account: Safari · iOS/);

    await phone.postJson('/login', { email: ADMIN.email, password: ADMIN.password });
    assert.equal((await inbox(admin)).match(/New sign-in/g)!.length, 1, 'known from then on');
  });

  // Bob's account is in French, the language a new account starts in, and each line is
  // worded in its reader's language whoever caused it.
  it('tells the other members about a new wish, a run of them as one line', async () => {
    await addMusic(admin, { title: 'Kind of Blue', artist: 'Miles Davis', in_wishlist: 'true' });
    assert.match(await inboxWith(bob, /liste de souhaits/), /admin a ajouté Kind of Blue à la liste de souhaits/);
    assert.doesNotMatch(await inbox(admin), /to the wishlist/, 'never about their own');

    await addMusic(admin, { title: 'Blue Train', artist: 'John Coltrane', in_wishlist: 'true' });
    const text = await inboxWith(bob, /2 items/);
    assert.match(text, /admin a ajouté 2 items à la liste de souhaits, dont Blue Train/);
    assert.equal(text.match(/liste de souhaits/g)!.length, 1);

    await addMusic(admin, { title: 'Abbey Road', artist: 'The Beatles' });
    assert.doesNotMatch(await inbox(bob), /3 items/, 'an item of the collection is no wish');
  });

  it('checks for a newer release only once asked, and tells the admins once', async () => {
    assert.equal(releaseAsked, 0, 'off until an admin turns it on');
    assert.doesNotMatch((await bob.get('/notifications/settings')).text, /A new DVinyl version/);
    assert.match((await admin.get('/notifications/settings')).text, /A new DVinyl version/);

    const reply = await admin.postForm('/admin/instance/updates', { enabled: 'on' });
    assert.equal(reply.location, '/admin/instance?msg=saved#updates');
    assert.equal(releaseAsked, 1);
    assert.match(await inbox(admin), /DVinyl 99\.0\.0 is out/);
    assert.doesNotMatch(await inbox(bob), /DVinyl 99\.0\.0/);
    assert.match((await admin.get('/admin/instance')).text, /DVinyl 99\.0\.0 is available/);

    await admin.postForm('/admin/instance/updates', { enabled: 'on' });
    assert.equal(releaseAsked, 2);
    assert.equal((await inbox(admin)).match(/DVinyl 99\.0\.0 is out/g)!.length, 1, 'once per release');

    await admin.postForm('/admin/instance/updates', {});
    assert.equal(releaseAsked, 2, 'off again');
  });

  it('offers the request templates of the plugins that are on', async () => {
    await enableModules(admin, ['music']);
    assert.doesNotMatch((await admin.get('/admin')).text, /data-type-template="boardgames\.play"/);
    await enableModules(admin, ['music', 'boardgames']);
    const page = (await admin.get('/admin')).text;
    assert.match(page, /data-type-template="loan"/);
    assert.match(page, /data-type-template="boardgames\.play"/);
  });

  it('tells an account it was locked after too many wrong passwords', async () => {
    const stranger = app.client();
    for (let i = 0; i < 4; i++) await stranger.postJson('/login', { email: 'bob@example.test', password: 'wrong' });
    assert.match(await inboxWith(bob, /bloqué/), /Votre compte a été bloqué quelques minutes/);
  });
});
