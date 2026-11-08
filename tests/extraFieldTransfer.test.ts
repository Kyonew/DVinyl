import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertForNative } from '../core/extraFieldTransfer';
import { findNativeLookalikes, sanitizeExtraFields } from '../core/pluginExtraFields';

const text: any = { name: 'custom_000000000001', label: 'X', type: 'text' };

test('a value is turned into what the plugin field stores, or refused', () => {
  assert.deepEqual(convertForNative('180', text, { type: 'number' } as any), { ok: true, value: 180 });
  assert.deepEqual(convertForNative('7,5', text, { type: 'number' } as any), { ok: true, value: 7.5 });
  assert.equal(convertForNative('heavy', text, { type: 'number' } as any).ok, false);
  assert.deepEqual(convertForNative('EMI, Pallas', text, { type: 'tags' } as any), { ok: true, value: ['EMI', 'Pallas'] });
  assert.deepEqual(convertForNative(['a', 'b'], { ...text, type: 'tags' }, { type: 'text' } as any), { ok: true, value: 'a, b' });
  assert.equal(convertForNative(true, { ...text, type: 'boolean' }, { type: 'text' } as any).ok, false);
  assert.equal(convertForNative('', text, { type: 'text' } as any).ok, false);
});

test('a select is matched on how its options read', () => {
  const custom: any = { ...text, type: 'select', options: [{ value: 'twelve', label: '12"' }] };
  const native: any = { type: 'select', options: [{ value: '', label: '-' }, { value: '12"', label: 'sizes.twelve' }] };
  assert.deepEqual(convertForNative('twelve', custom, native), { ok: true, value: '12"' });
  assert.deepEqual(convertForNative('LP', text, { type: 'select', options: [{ value: 'lp', label: 'types.lp' }] } as any, k => (k === 'types.lp' ? 'LP' : k)), { ok: true, value: 'lp' });
  assert.equal(convertForNative('Box', text, native).ok, false);
});

test('a field kept on purpose beside its lookalike is no longer reported, and the choice survives a save', () => {
  const plugin: any = { id: 'music', formFields: [{ name: 'label', label: 'fields.label', type: 'text', showIn: ['edit'] }] };
  const def: any = { ...text, label: 'Label', keyVersion: 1 };
  assert.equal(findNativeLookalikes(plugin, [def], k => [k === 'fields.label' ? 'Label' : k]).length, 1);
  assert.equal(findNativeLookalikes(plugin, [{ ...def, keepBeside: 'label' }], k => [k === 'fields.label' ? 'Label' : k]).length, 0);
  const { fields } = sanitizeExtraFields([{ name: def.name, label: 'Label', keepBeside: 'label' }, { label: 'Other', keepBeside: 'title' }], plugin, [def]);
  assert.deepEqual(fields.map(f => f.keepBeside), ['label', undefined]);
});
