import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPluginGenerationPrompt, sanitizePluginDraft } from './pluginGenerate';

test('the prompt carries the description and demands JSON', () => {
  const messages = buildPluginGenerationPrompt('old glass Coca-Cola bottles');
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[1]?.role, 'user');
  const all = JSON.stringify(messages);
  assert.match(all, /old glass Coca-Cola bottles/);
  assert.match(all, /JSON/i);
  assert.match(all, /fields/i);
  assert.match(all, /formats/i);
});

test('the prompt lists the real color palette so the model cannot invent one', () => {
  const messages = buildPluginGenerationPrompt('stamps');
  const all = JSON.stringify(messages);
  assert.match(all, /teal/);
  assert.match(all, /stone/);
});

test('a fully valid draft passes through with fields and formats slugified', () => {
  const draft = sanitizePluginDraft({
    label: 'Vintage Cameras',
    icon: 'fa-camera-retro',
    color: 'amber',
    creatorLabel: 'Manufacturer',
    aspectRatioClass: 'aspect-[2/3]',
    features: { year: true, rating: true, barcode: false },
    fields: [
      { label: 'Film Format', type: 'select', required: true, options: ['35mm', 'Medium Format'] },
      { label: 'Serial Number', type: 'text', required: false }
    ],
    formats: [{ label: 'SLR' }, { label: 'Rangefinder' }]
  });

  assert.equal(draft.label, 'Vintage Cameras');
  assert.equal(draft.icon, 'fa-camera-retro');
  assert.equal(draft.color, 'amber');
  assert.equal(draft.creatorLabel, 'Manufacturer');
  assert.equal(draft.aspectRatioClass, 'aspect-[2/3]');
  assert.deepEqual(draft.features, { year: true, rating: true });
  assert.equal(draft.fields.length, 2);
  assert.equal(draft.fields[0]?.label, 'Film Format');
  assert.equal(draft.fields[0]?.type, 'select');
  assert.deepEqual(draft.fields[0]?.options, [
    { value: '35mm', label: '35mm' },
    { value: 'medium_format', label: 'Medium Format' }
  ]);
  assert.equal(draft.fields[1]?.required, false);
  assert.deepEqual(draft.formats, [{ label: 'SLR' }, { label: 'Rangefinder' }]);
});

test('an unknown icon falls back to the default', () => {
  const draft = sanitizePluginDraft({ label: 'X', icon: 'not-an-icon', creatorLabel: 'Y' });
  assert.equal(draft.icon, 'fa-box');
});

test('an unknown color falls back to the palette default', () => {
  const draft = sanitizePluginDraft({ label: 'X', color: 'chartreuse', creatorLabel: 'Y' });
  assert.equal(draft.color, 'teal');
});

test('an unknown aspect ratio falls back to the default', () => {
  const draft = sanitizePluginDraft({ label: 'X', aspectRatioClass: 'aspect-[3/1]', creatorLabel: 'Y' });
  assert.equal(draft.aspectRatioClass, 'aspect-[2/3]');
});

test('an unknown feature key is dropped, known ones survive', () => {
  const draft = sanitizePluginDraft({
    label: 'X', creatorLabel: 'Y',
    features: { year: true, madeUpFeature: true, tracklist: true }
  });
  assert.deepEqual(draft.features, { year: true });
});

test('a select field with no usable options is downgraded to text, not dropped', () => {
  const draft = sanitizePluginDraft({
    label: 'X', creatorLabel: 'Y',
    fields: [{ label: 'Condition', type: 'select', options: [] }]
  });
  assert.equal(draft.fields.length, 1);
  assert.equal(draft.fields[0]?.type, 'text');
  assert.equal(draft.fields[0]?.options, undefined);
});

test('an unknown field type falls back to text', () => {
  const draft = sanitizePluginDraft({
    label: 'X', creatorLabel: 'Y',
    fields: [{ label: 'Weight', type: 'currency' }]
  });
  assert.equal(draft.fields[0]?.type, 'text');
});

test('too many fields and formats are capped, not rejected', () => {
  const manyFields = Array.from({ length: 20 }, (_, i) => ({ label: `Field ${i}`, type: 'text' }));
  const manyFormats = Array.from({ length: 20 }, (_, i) => ({ label: `Format ${i}` }));
  const draft = sanitizePluginDraft({ label: 'X', creatorLabel: 'Y', fields: manyFields, formats: manyFormats });
  assert.ok(draft.fields.length <= 8);
  assert.ok(draft.formats.length <= 6);
});

test('a field name colliding with a reserved name is dropped', () => {
  const draft = sanitizePluginDraft({
    label: 'X', creatorLabel: 'Y',
    fields: [
      { label: 'Description', type: 'text' },
      { label: 'Real Field', type: 'text' }
    ]
  });
  assert.equal(draft.fields.length, 1);
  assert.equal(draft.fields[0]?.label, 'Real Field');
});

test('a field with no label is dropped rather than rendered blank', () => {
  const draft = sanitizePluginDraft({
    label: 'X', creatorLabel: 'Y',
    fields: [{ label: '', type: 'text' }, { label: 'Real Field', type: 'text' }]
  });
  assert.equal(draft.fields.length, 1);
  assert.equal(draft.fields[0]?.label, 'Real Field');
});

test('garbage input never throws and always returns a usable shape', () => {
  assert.doesNotThrow(() => sanitizePluginDraft(null));
  assert.doesNotThrow(() => sanitizePluginDraft(undefined));
  assert.doesNotThrow(() => sanitizePluginDraft('not an object'));
  assert.doesNotThrow(() => sanitizePluginDraft([1, 2, 3]));
  const draft = sanitizePluginDraft(null);
  assert.equal(draft.label, '');
  assert.equal(draft.icon, 'fa-box');
  assert.equal(draft.color, 'teal');
  assert.deepEqual(draft.fields, []);
  assert.deepEqual(draft.formats, []);
  assert.deepEqual(draft.features, {});
});
