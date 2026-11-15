import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consolesFromPlatform } from '../plugins/games/igdbPlatforms';
import { fieldShownFor } from '../core/fieldConditions';
import { gamesPlugin } from '../plugins/games';

const ps2 = {
  id: 8, name: 'PlayStation 2', slug: 'ps2', summary: 'Sony console',
  platform_logo: { url: '//images.igdb.com/igdb/image/upload/t_thumb/pl72.jpg' },
  versions: [
    { id: 58, name: 'Initial version', platform_logo: { url: '//images.igdb.com/igdb/image/upload/t_thumb/pl71.jpg' },
      platform_version_release_dates: [{ y: 2000 }, { y: 2003 }] },
    { id: 114, name: 'Slimline', platform_version_release_dates: [{ y: 2004 }] }
  ]
};

test('each model of a platform is a console of its own', () => {
  const consoles = consolesFromPlatform(ps2);
  assert.deepEqual(consoles.map(c => [c.id, c.title, c.year]), [
    ['8-58', 'PlayStation 2', '2000'],
    ['8-114', 'PlayStation 2 (Slimline)', '2004']
  ]);
  assert.equal(consoles[0].cover_image, 'https://images.igdb.com/igdb/image/upload/t_720p/pl71.jpg');
  // A model without a picture of its own shows the platform's.
  assert.equal(consoles[1].cover_image, 'https://images.igdb.com/igdb/image/upload/t_720p/pl72.jpg');
  assert.equal(consoles[1].item_kind, 'console');
  assert.equal(consoles[1].platform, 'PlayStation 2');
  assert.equal(consoles[1].igdb_platform_slug, 'ps2');
});

test('a platform with one model or none is one console, under the platform id', () => {
  assert.deepEqual(consolesFromPlatform({ id: 3, name: 'Dreamcast', versions: [{ id: 9, name: 'Initial version' }] }).map(c => c.id), ['3']);
  assert.deepEqual(consolesFromPlatform({ id: 4, name: 'Vectrex' }).map(c => [c.id, c.cover_image]), [['4', '/ressources/logo.png']]);
  assert.deepEqual(consolesFromPlatform(null), []);
});

test('a conditional field shows for the values it lists, an empty one included', () => {
  const developer = gamesPlugin.formFields.find(f => f.name === 'developer')!;
  const manufacturer = gamesPlugin.formFields.find(f => f.name === 'manufacturer')!;
  assert.equal(fieldShownFor(developer, { item_kind: 'game' }), true);
  assert.equal(fieldShownFor(developer, {}), true);
  assert.equal(fieldShownFor(developer, { item_kind: 'console' }), false);
  assert.equal(fieldShownFor(manufacturer, { item_kind: 'accessory' }), true);
  assert.equal(fieldShownFor(manufacturer, { item_kind: 'game' }), false);
  assert.equal(fieldShownFor({ name: 'x' } as any, { item_kind: 'console' }), true);
});

test('hardware stays out of the game counts and shows its maker under its name', () => {
  const stats = gamesPlugin.getStats!([
    { item_kind: 'game', format: 'physical', quantity: 2 },
    { format: 'physical' },
    { item_kind: 'console', format: 'physical' }
  ]);
  assert.equal(stats.game_total, 3);
  assert.equal(stats.game_physical, 3);
  assert.equal(gamesPlugin.formatForView({ item_kind: 'console', manufacturer: 'Sony', developer: '' }).developer, 'Sony');
  assert.equal(gamesPlugin.formatForView({ developer: 'Capcom' }).developer, 'Capcom');
});
