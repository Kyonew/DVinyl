import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  EXTRA_FIELD_KEY_RE,
  EXTRA_FIELD_KEY_VERSION,
  isManagedExtraFieldKey,
  migratedExtraFieldKey
} from '../core/extraFieldIdentity';
import { sanitizeExtraFields } from '../core/pluginExtraFields';
import { rewriteExtraFieldReferences } from '../utils/migrateExtraFieldIdentities';
import { loadPluginFromDir, PLUGINS_DIR } from '../core/loadPlugins';
import { buildConfigFromSubmission } from '../core/customPluginStore';
import { registry } from '../core/registry';

const plugin: any = {
  id: 'games',
  kind: 'Game',
  schemaDefinition: { igdb_id: Number, playtime: Number },
  formFields: [
    { name: 'title', label: 'Title', type: 'text', showIn: ['edit'] },
    { name: 'playtime', label: 'Playtime', type: 'number', showIn: ['edit'] }
  ],
  creatorField: 'developer',
  externalIdField: 'igdb_id'
};

test('new extra fields receive opaque server-generated identities', () => {
  const result = sanitizeExtraFields([
    { name: 'playtime', label: 'Playtime', type: 'number', group: 'metadata' }
  ], plugin);

  assert.deepEqual(result.errors, []);
  assert.equal(result.fields.length, 1);
  assert.match(result.fields[0]!.name, EXTRA_FIELD_KEY_RE);
  assert.notEqual(result.fields[0]!.name, 'playtime');
  assert.equal(result.fields[0]!.keyVersion, EXTRA_FIELD_KEY_VERSION);
});

test('renaming a label preserves an existing managed identity', () => {
  const existing = [{
    name: 'custom_012345abcdef',
    label: 'Playtime',
    type: 'number' as const,
    keyVersion: EXTRA_FIELD_KEY_VERSION
  }];
  const result = sanitizeExtraFields([
    { name: existing[0]!.name, label: 'Time played', type: 'number' }
  ], plugin, existing);

  assert.deepEqual(result.errors, []);
  assert.equal(result.fields[0]!.name, existing[0]!.name);
  assert.equal(result.fields[0]!.label, 'Time played');
  assert.equal(isManagedExtraFieldKey(result.fields[0]!.name, result.fields[0]!.keyVersion), true);
});

test('legacy migration identities are deterministic and scoped', () => {
  const first = migratedExtraFieldKey('settings-a', 'games', 'playtime', 0);
  assert.equal(first, migratedExtraFieldKey('settings-a', 'games', 'playtime', 0));
  assert.notEqual(first, migratedExtraFieldKey('settings-b', 'games', 'playtime', 0));
  assert.notEqual(first, migratedExtraFieldKey('settings-a', 'music', 'playtime', 0));
  assert.match(first, EXTRA_FIELD_KEY_RE);
});

test('card and corner references follow migrated identities', () => {
  const source = {
    games: {
      icon: 'fa-gamepad',
      cardFields: ['developer', 'playtime'],
      cornerField: 'playtime'
    },
    music: { cardFields: ['artist'] }
  };
  const result = rewriteExtraFieldReferences(source, 'games', [
    { from: 'playtime', to: 'custom_012345abcdef' }
  ]);

  assert.equal(result.changed, 2);
  assert.deepEqual(result.customization.games.cardFields, ['developer', 'custom_012345abcdef']);
  assert.equal(result.customization.games.cornerField, 'custom_012345abcdef');
  assert.deepEqual(result.customization.music, source.music);
  assert.deepEqual(source.games.cardFields, ['developer', 'playtime']);
});

test('bundled plugins respect the reserved extra-field namespace', () => {
  const directories = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  for (const directory of directories) {
    const result = loadPluginFromDir(directory);
    assert.ok(result.plugin, `plugins/${directory}: ${result.errors.join(', ')}`);
  }
});

test('new no-code plugin fields cannot claim the generated namespace', () => {
  const result = buildConfigFromSubmission({
    id: 'qa-reserved-prefix',
    label: 'QA plugin',
    icon: 'fa-box',
    color: 'teal',
    creatorLabel: 'Maker',
    features: {},
    formats: [],
    fields: [{ name: 'custom_claimed', label: 'Claimed', type: 'text' }]
  });

  assert.ok(result.errors.includes('create_plugin.err_reserved_field'));
  assert.equal(result.config, undefined);
});

test('a leftover extra value never surfaces under a native field name', () => {
  const loaded = loadPluginFromDir('games');
  assert.ok(loaded.plugin, loaded.errors.join(', '));
  registry.register(loaded.plugin);
  try {
    const view = loaded.plugin.formatForView({
      kind: 'Game',
      title: 'No native platform',
      extra: { platform: 'Legacy custom value', custom_0123456789ab: 'Current value' }
    });
    assert.equal(view.platform, undefined);
    assert.equal(view.custom_0123456789ab, 'Current value');
  } finally {
    registry.unregister('games');
  }
});
