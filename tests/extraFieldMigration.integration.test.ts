import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import Item from '../models/Item';
import Settings from '../models/Settings';
import CustomPlugin from '../models/CustomPlugin';
import { registry } from '../core/registry';
import { loadPluginFromDir } from '../core/loadPlugins';
import { EXTRA_FIELD_KEY_VERSION, migratedExtraFieldKey } from '../core/extraFieldIdentity';
import { migrateExtraFieldIdentities } from '../utils/migrateExtraFieldIdentities';

const mongoUrl = process.env.TEST_MONGODB_URL || '';
const safeDatabaseName = 'dvinyl_issue151_test';

test('legacy custom fields migrate without overwriting data and remain idempotent', {
  skip: !mongoUrl
}, async t => {
  assert.match(mongoUrl, new RegExp(`/${safeDatabaseName}(?:[?]|$)`), 'integration test must use its isolated database');
  await mongoose.connect(mongoUrl);

  const loaded = loadPluginFromDir('games');
  assert.ok(loaded.plugin, loaded.errors.join(', '));
  registry.register(loaded.plugin);

  t.after(async () => {
    await mongoose.connection.dropDatabase();
    registry.unregister('games');
    await mongoose.disconnect();
  });
  await mongoose.connection.dropDatabase();

  const collectionId = new mongoose.Types.ObjectId();
  const settingsId = new mongoose.Types.ObjectId();
  const interruptedTarget = migratedExtraFieldKey(String(settingsId), 'games', 'platform', 0);

  await Settings.collection.insertOne({
    _id: settingsId,
    collection: collectionId,
    pluginExtraFields: {
      games: [
        { name: 'platform', label: 'My platform', type: 'text', group: 'metadata' },
        { name: 'playtime', label: 'Playtime', type: 'number', group: 'metadata' },
        { name: 'finished_on', label: 'Finished on', type: 'date', group: 'metadata' },
        { name: 'moods', label: 'Moods', type: 'tags', group: 'metadata' },
        { name: 'signed', label: 'Signed', type: 'boolean', group: 'metadata' },
        {
          name: 'condition',
          label: 'Condition',
          type: 'select',
          group: 'metadata',
          options: [{ value: 'mint', label: 'Mint' }]
        },
        { name: 'notes', label: 'Notes', type: 'textarea', group: 'metadata' }
      ]
    },
    pluginCustomization: {
      games: {
        icon: 'fa-gamepad',
        cardFields: ['developer', 'platform', 'playtime'],
        cornerField: 'platform'
      }
    }
  } as any);

  const firstItemId = new mongoose.Types.ObjectId();
  const secondItemId = new mongoose.Types.ObjectId();
  await Item.collection.insertMany([
    {
      _id: firstItemId,
      collection: collectionId,
      kind: 'Game',
      title: 'First game',
      platform: 'Native platform value',
      extra: {
        platform: 'Custom platform value',
        playtime: 42,
        finished_on: new Date('2026-04-05T00:00:00.000Z'),
        moods: ['cozy', 'challenging'],
        signed: false,
        condition: 'mint',
        notes: 'A multiline-safe note',
        // Simulates a process stopped after copying one value but before Settings
        // was switched to the generated identity.
        [interruptedTarget]: 'Custom platform value'
      }
    },
    {
      _id: secondItemId,
      collection: collectionId,
      kind: 'Game',
      title: 'Second game',
      platform: 'Another native value',
      extra: { platform: 'Second custom value' }
    }
  ] as any[]);

  const firstRun = await migrateExtraFieldIdentities({ collectionId });
  assert.deepEqual(firstRun, { fields: 7, values: 7, references: 3, skipped: 0 });

  const migratedSettings: any = await Settings.collection.findOne({ _id: settingsId });
  const fields = migratedSettings.pluginExtraFields.games;
  const platformField = fields.find((field: any) => field.label === 'My platform');
  const playtimeField = fields.find((field: any) => field.label === 'Playtime');
  const dateField = fields.find((field: any) => field.label === 'Finished on');
  const tagsField = fields.find((field: any) => field.label === 'Moods');
  const booleanField = fields.find((field: any) => field.label === 'Signed');
  const selectField = fields.find((field: any) => field.label === 'Condition');
  const textareaField = fields.find((field: any) => field.label === 'Notes');
  assert.equal(platformField.name, interruptedTarget);
  assert.equal(platformField.keyVersion, EXTRA_FIELD_KEY_VERSION);
  assert.equal(playtimeField.keyVersion, EXTRA_FIELD_KEY_VERSION);
  assert.notEqual(playtimeField.name, 'playtime');
  assert.deepEqual(migratedSettings.pluginCustomization.games.cardFields, [
    'developer', platformField.name, playtimeField.name
  ]);
  assert.equal(migratedSettings.pluginCustomization.games.cornerField, platformField.name);

  const firstItem: any = await Item.collection.findOne({ _id: firstItemId });
  const secondItem: any = await Item.collection.findOne({ _id: secondItemId });
  assert.equal(firstItem.platform, 'Native platform value');
  assert.equal(firstItem.extra[platformField.name], 'Custom platform value');
  assert.equal(firstItem.extra[playtimeField.name], 42);
  assert.ok(firstItem.extra[dateField.name] instanceof Date);
  assert.equal(firstItem.extra[dateField.name].toISOString(), '2026-04-05T00:00:00.000Z');
  assert.deepEqual(firstItem.extra[tagsField.name], ['cozy', 'challenging']);
  assert.equal(firstItem.extra[booleanField.name], false);
  assert.equal(firstItem.extra[selectField.name], 'mint');
  assert.equal(firstItem.extra[textareaField.name], 'A multiline-safe note');
  assert.equal(secondItem.platform, 'Another native value');
  assert.equal(secondItem.extra[platformField.name], 'Second custom value');
  assert.equal(firstItem.extra.platform, 'Custom platform value');

  const snapshot = JSON.stringify({ settings: migratedSettings, firstItem, secondItem });
  const secondRun = await migrateExtraFieldIdentities({ collectionId });
  assert.deepEqual(secondRun, { fields: 0, values: 0, references: 0, skipped: 0 });
  assert.equal(JSON.stringify({
    settings: await Settings.collection.findOne({ _id: settingsId }),
    firstItem: await Item.collection.findOne({ _id: firstItemId }),
    secondItem: await Item.collection.findOne({ _id: secondItemId })
  }), snapshot);

  // A restored no-code plugin can be known from the DB before it is registered.
  // If the deterministic target already holds a different value, the migration
  // must select another identity rather than overwrite it.
  const customCollectionId = new mongoose.Types.ObjectId();
  const customSettingsId = new mongoose.Types.ObjectId();
  const conflictingTarget = migratedExtraFieldKey(String(customSettingsId), 'figures', 'notes', 0);
  const fallbackTarget = migratedExtraFieldKey(String(customSettingsId), 'figures', 'notes', 0, 1);
  await CustomPlugin.collection.insertOne({
    id: 'figures',
    kind: 'CustomFigures',
    config: { custom: true, id: 'figures', kind: 'CustomFigures' }
  } as any);
  await Settings.collection.insertOne({
    _id: customSettingsId,
    collection: customCollectionId,
    pluginExtraFields: {
      figures: [{ name: 'notes', label: 'Notes', type: 'text', group: 'metadata' }]
    },
    pluginCustomization: {}
  } as any);
  const customItemId = new mongoose.Types.ObjectId();
  await Item.collection.insertMany([
    {
      _id: customItemId,
      collection: customCollectionId,
      kind: 'CustomFigures',
      title: 'Robot',
      extra: { notes: 'Value to migrate' }
    },
    {
      _id: new mongoose.Types.ObjectId(),
      collection: customCollectionId,
      kind: 'CustomFigures',
      title: 'Orphaned value',
      extra: { [conflictingTarget]: 'Do not expose' }
    }
  ] as any[]);

  const customRun = await migrateExtraFieldIdentities({ collectionId: customCollectionId });
  assert.deepEqual(customRun, { fields: 1, values: 1, references: 0, skipped: 0 });
  const customSettings: any = await Settings.collection.findOne({ _id: customSettingsId });
  const customItem: any = await Item.collection.findOne({ _id: customItemId });
  assert.equal(customSettings.pluginExtraFields.figures[0].name, fallbackTarget);
  assert.equal(customItem.extra[fallbackTarget], 'Value to migrate');

  // The same legacy name in another collection gets its own identity and only
  // touches that collection's items.
  const otherCollectionId = new mongoose.Types.ObjectId();
  const otherSettingsId = new mongoose.Types.ObjectId();
  await Settings.collection.insertOne({
    _id: otherSettingsId,
    collection: otherCollectionId,
    pluginExtraFields: {
      games: [{ name: 'playtime', label: 'Playtime', type: 'number', group: 'metadata' }]
    },
    pluginCustomization: {}
  } as any);
  const otherItemId = new mongoose.Types.ObjectId();
  await Item.collection.insertOne({
    _id: otherItemId,
    collection: otherCollectionId,
    kind: 'Game',
    title: 'Other collection game',
    extra: { playtime: 5 }
  } as any);

  const otherRun = await migrateExtraFieldIdentities({ collectionId: otherCollectionId });
  assert.deepEqual(otherRun, { fields: 1, values: 1, references: 0, skipped: 0 });
  const otherSettings: any = await Settings.collection.findOne({ _id: otherSettingsId });
  const otherItem: any = await Item.collection.findOne({ _id: otherItemId });
  const otherKey = otherSettings.pluginExtraFields.games[0].name;
  assert.notEqual(otherKey, playtimeField.name);
  assert.equal(otherItem.extra[otherKey], 5);
  assert.equal(firstItem.extra[playtimeField.name], 42);
});
