import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenericCsvSpec, previewCsv, resolveDelimiter } from '../../../core/genericCsvImport';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings } from '../../../test/helpers/factories';
import { loadPluginsOnce, registerTestPlugin, TEST_PLUGIN_ID, TEST_PLUGIN_TYPE } from '../../../test/helpers/plugins';

before(async () => { loadPluginsOnce(); registerTestPlugin(); await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

async function seed() {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role: 'admin' }] });
  const settings = await makeSettings(collection, { modules: { [TEST_PLUGIN_TYPE]: true } });
  return { collection, settings };
}

describe('previewCsv', () => {
  test('reports columns, total, delimiter and samples', () => {
    const result = previewCsv('Title;Creator\nA;B\nC;D\nE;F\nG;H');
    assert.ok('preview' in result);
    assert.equal(result.preview.delimiter, ';');
    assert.deepEqual(result.preview.columns, ['Title', 'Creator']);
    assert.equal(result.preview.total, 4);
    assert.equal(result.preview.samples.length, 3);
    assert.equal(result.preview.duplicateColumns, false);
  });

  test('flags duplicate headers collapsed into one key', () => {
    const result = previewCsv('Title,Title\nA,B');
    assert.ok('preview' in result);
    assert.deepEqual(result.preview.columns, ['Title']);
    assert.equal(result.preview.duplicateColumns, true);
  });

  test('rejects a missing or empty file', () => {
    assert.deepEqual(previewCsv(''), { error: 'no_file' });
    assert.deepEqual(previewCsv(undefined), { error: 'no_file' });
  });
});

describe('resolveDelimiter', () => {
  test('honours a supported requested delimiter and detects otherwise', () => {
    assert.equal(resolveDelimiter(';', 'a;b'), ';');
    assert.equal(resolveDelimiter('nope', 'a;b'), ';');
  });
});

describe('buildGenericCsvSpec', () => {
  test('builds a spec mapping columns onto the target plugin', async () => {
    const { settings } = await seed();
    const plugin = registerTestPlugin();
    const body = {
      csv: 'Title,Creator\nAlpha,Ann',
      plugin: TEST_PLUGIN_ID,
      mapping: { title: { source: 'column', column: 'Title' }, creator: { source: 'column', column: 'Creator' } }
    };
    const result = buildGenericCsvSpec({ body, settings, enabledPlugins: [plugin] });
    assert.ok('target' in result);
    assert.equal(result.target.plugin.id, TEST_PLUGIN_ID);
    assert.deepEqual(result.target.spec.mapRow!({ Title: 'Alpha', Creator: 'Ann' }, {} as any), { title: 'Alpha', creator: 'Ann' });
  });

  test('rejects an unknown or disabled module with its id', async () => {
    const { settings } = await seed();
    const result = buildGenericCsvSpec({ body: { csv: 'Title\nA', plugin: 'nope', mapping: {} }, settings, enabledPlugins: [] });
    assert.deepEqual(result, { error: 'unknown_module', detail: 'nope' });
  });

  test('rejects a mapping missing a required field', async () => {
    const { settings } = await seed();
    const plugin = registerTestPlugin();
    const result = buildGenericCsvSpec({
      body: { csv: 'Creator\nAnn', plugin: TEST_PLUGIN_ID, mapping: { creator: { source: 'column', column: 'Creator' } } },
      settings,
      enabledPlugins: [plugin]
    });
    assert.ok('error' in result);
    assert.equal(result.error, 'missing_required');
    // No translate resolver is passed, so the field label falls back to the bare name.
    assert.match(String(result.detail), /title/i);
  });

  test('rejects a missing or empty csv', async () => {
    const { settings } = await seed();
    assert.deepEqual(buildGenericCsvSpec({ body: { plugin: TEST_PLUGIN_ID }, settings, enabledPlugins: [] }), { error: 'no_file' });
  });
});
