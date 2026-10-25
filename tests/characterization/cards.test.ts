import assert from 'node:assert/strict';
import vm from 'node:vm';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { enableModules, exportInstance, InstanceDump, saveItem, setupAdmin } from './fixtures';

const backend = backendFor('cards');

const CARD_MODULES = ['pokemon', 'mtg', 'yugioh', 'onepiece', 'lorcana', 'swu', 'digimon', 'fab'];

async function save(client: Client, pluginId: string, fields: Record<string, string>) {
  const reply = await saveItem(client, pluginId, fields);
  assert.equal(reply.status, 302, `save-${pluginId} failed (${reply.status}): ${reply.text.slice(0, 300)}`);
  return reply;
}

const charizards = (dump: InstanceDump) => dump.albums
  .filter(item => item.kind === 'Pokemon' && item.title === 'Charizard ex')
  .map(item => [item.pokemon_card_id, item.card_condition, item.in_wishlist, item.quantity].join('|'))
  .sort();

describe('trading card plugins', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, CARD_MODULES);
  });
  after(async () => { await app?.stop(); });

  it('counts copies of one printing and keeps other printings and conditions apart', async () => {
    const card = { title: 'Charizard ex', set_name: 'Obsidian Flames', category: 'Pokemon', hp: '330', types: 'Fire, Dragon' };
    await save(admin, 'pokemon', { ...card, pokemon_card_id: 'sv03-125' });
    await save(admin, 'pokemon', { ...card, pokemon_card_id: 'sv03-125' });
    // The special illustration rare shares its name and set with the regular card.
    await save(admin, 'pokemon', { ...card, pokemon_card_id: 'sv03-223' });
    await save(admin, 'pokemon', { ...card, pokemon_card_id: 'sv03-125', card_condition: 'Near Mint' });
    await save(admin, 'pokemon', { ...card, pokemon_card_id: 'sv03-125', in_wishlist: 'true' });

    const dump = await exportInstance(admin);
    assert.deepEqual(charizards(dump), [
      'sv03-125|Near Mint|false|1',
      'sv03-125||false|2',
      'sv03-125||true|1',
      'sv03-223||false|1'
    ]);
    const stored = dump.albums.find(item => item.pokemon_card_id === 'sv03-223');
    assert.equal(stored.hp, 330, 'a number field is stored as a number');
    assert.deepEqual(stored.types, ['Fire', 'Dragon'], 'a tags input posts one comma-separated text');
    assert.deepEqual(stored.genres, ['Fire', 'Dragon'], 'the types are mirrored into the genres');
  });

  it('matches a hand-typed card on its name and set', async () => {
    await save(admin, 'pokemon', { title: 'Pikachu', set_name: 'Base Set' });
    await save(admin, 'pokemon', { title: 'pikachu', set_name: 'base set' });
    await save(admin, 'pokemon', { title: 'Pikachu', set_name: 'Jungle' });

    const pikachus = (await exportInstance(admin)).albums
      .filter(item => item.kind === 'Pokemon' && /pikachu/i.test(item.title))
      .map(item => [item.set_name, item.quantity].join('|'))
      .sort();
    assert.deepEqual(pikachus, ['Base Set|2', 'Jungle|1']);
  });

  it('hands only the cards it can price to the estimate', async () => {
    const reply = await admin.get('/api/pokemon/collection/ids');
    const { success, albums } = reply.json();
    assert.equal(success, true);
    assert.deepEqual(albums.map((a: any) => [a.pokemon_card_id, a.quantity]).sort(),
      [['sv03-125', 1], ['sv03-125', 2], ['sv03-223', 1]]);
  });

  it('keeps every type apart from the others', async () => {
    await save(admin, 'mtg', { title: 'Lightning Bolt', set_name: 'Alpha', card_type: 'Instant', scryfall_id: 'a-1' });
    await save(admin, 'yugioh', { title: 'Dark Magician', set_name: 'LOB', card_type: 'Monster', ygo_card_id: '46986414::LOB-005::0', atk: '2500' });
    await save(admin, 'lorcana', { title: 'Mulan - Reflecting', set_name: 'Into the Inklands', inkable: 'true' });
    await save(admin, 'fab', { title: 'Snatch', set_name: 'Welcome to Rathe', card_color: 'Red', pitch: '1' });

    const dump = await exportInstance(admin);
    const kinds = (title: string) => dump.albums.filter(item => item.title === title).map(item => item.kind);
    assert.deepEqual(kinds('Lightning Bolt'), ['Mtg']);
    assert.deepEqual(kinds('Dark Magician'), ['Yugioh']);
    assert.equal(dump.albums.find(item => item.title === 'Dark Magician').atk, 2500);
    assert.equal(dump.albums.find(item => item.title === 'Mulan - Reflecting').inkable, true);
    assert.equal(dump.albums.find(item => item.title === 'Snatch').card_color, 'Red');
  });

  it('offers no card scan without the AI assist, and every inline script of the add page parses', async () => {
    for (const id of ['pokemon', 'yugioh']) {
      const html = (await admin.get(`/add-${id}`)).text;
      assert.ok(!html.includes('id="start-card-scan"'), `${id}: no card scan without a model to read the photo`);
      assert.ok(!html.includes('id="start-scan"'), `${id}: a card has no barcode to scan`);

      const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]!);
      assert.ok(scripts.length > 0);
      for (const body of scripts) assert.doesNotThrow(() => new vm.Script(body), `${id}: ${body.slice(0, 120)}`);
    }
  });
});
