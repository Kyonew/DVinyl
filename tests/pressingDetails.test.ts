import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pressingFromDiscogs } from '../plugins/music/pressing';
import { hasRows, parseRows, rowColumns } from '../core/rowsField';
import { sanitizeExtraFields, toFieldDefinitions } from '../core/pluginExtraFields';

test('reads runouts per side, companies by role, engineers and the rights society off a Discogs release', () => {
  const details = pressingFromDiscogs({
    identifiers: [
      { type: 'Barcode', value: '0 75678 17771 4' },
      { type: 'Matrix / Runout', value: '781 768-1 A Alsdorf', description: 'Side A, variant 1' },
      { type: 'Matrix / Runout', value: 'STA 876 427 DMM', description: 'Runout side B' },
      { type: 'Matrix / Runout', value: 'Sterling' },
      { type: 'Rights Society', value: 'GEMA' }
    ],
    companies: [
      { entity_type_name: 'Pressed By', name: 'Record Service Alsdorf' },
      { entity_type_name: 'Mastered At', name: 'Sterling Sound (2)' },
      { entity_type_name: 'Lacquer Cut At', name: 'Sterling Sound' },
      { entity_type_name: 'Copyright (c)', name: 'Atlantic' }
    ],
    extraartists: [{ role: 'Lacquer Cut By', name: 'SP' }, { role: 'Producer', name: 'Someone' }]
  });
  assert.deepEqual(details.pressing_plant, ['Record Service Alsdorf']);
  assert.deepEqual(details.mastering_studio, ['Sterling Sound']);
  assert.deepEqual(details.mastering_engineer, ['SP']);
  assert.deepEqual(details.rights_society, ['GEMA']);
  assert.deepEqual(details.runouts, [
    { side: 'A', inscription: '781 768-1 A Alsdorf', notes: 'variant 1' },
    { side: 'B', inscription: 'STA 876 427 DMM', notes: '' },
    { side: '', inscription: 'Sterling', notes: '' }
  ]);
  assert.deepEqual(details.cutting_method, ['DMM', 'Lacquer']);
  assert.deepEqual(pressingFromDiscogs({}).runouts, []);
  assert.deepEqual(pressingFromDiscogs({}).cutting_method, []);
});

test('the cutting method is read from roles, format words and notes', () => {
  assert.deepEqual(pressingFromDiscogs({ companies: [{ entity_type_name: 'DMM Cut At', name: 'Teldec' }] }).cutting_method, ['DMM']);
  assert.deepEqual(pressingFromDiscogs({ formats: [{ name: 'Vinyl', text: 'DMM' }] }).cutting_method, ['DMM']);
  assert.deepEqual(pressingFromDiscogs({ notes: 'Cut using Direct Metal Mastering.' }).cutting_method, ['DMM']);
  assert.deepEqual(pressingFromDiscogs({ extraartists: [{ role: 'Lacquer Cut By', name: 'SP' }] }).cutting_method, ['Lacquer']);
  // A word that only contains the letters is not the method.
  assert.deepEqual(pressingFromDiscogs({ notes: 'Recorded at DMMX studio' }).cutting_method, []);
});

test('a repeating field keeps its declared columns only, as text, and drops empty rows', () => {
  const columns = rowColumns({ options: [{ value: 'side', label: 'Side' }, { value: 'inscription', label: 'Inscription' }] });
  assert.deepEqual(parseRows('[{"side":" A ","inscription":"781\\r\\n768","extra":"x"},{"side":""},5]', columns),
    [{ side: 'A', inscription: '781\n768' }]);
  assert.deepEqual(parseRows('not json', columns), []);
  assert.ok(hasRows([{ side: 'A' }]));
  assert.ok(!hasRows([{ side: '' }]));
});

test('a collection declares a repeating field by naming its columns', () => {
  const plugin: any = { id: 'music', storedFields: {}, formFields: [] };
  const { fields, errors } = sanitizeExtraFields([
    { label: 'Runouts', type: 'rows', options: ['Side', 'Inscription', 'side'] },
    { label: 'Empty', type: 'rows', options: [] }
  ], plugin, []);
  assert.deepEqual(errors, ['create_plugin.err_rows_needs_columns']);
  assert.deepEqual(fields[0]!.options, [{ value: 'side', label: 'Side' }, { value: 'inscription', label: 'Inscription' }]);
  assert.deepEqual(toFieldDefinitions(fields)[0]!.columns, [{ name: 'side', label: 'Side' }, { name: 'inscription', label: 'Inscription' }]);
});
