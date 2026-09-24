import assert from 'node:assert/strict';
import test from 'node:test';
import { pickDisplayName, locationKey } from '../utils/shelfHelpers';

test('keeps the spelling used by the most items', () => {
  assert.equal(pickDisplayName([{ name: 'salon', count: 1 }, { name: 'Salon', count: 4 }]), 'Salon');
});

test('on a tie, prefers a spelling typed without stray spaces', () => {
  assert.equal(pickDisplayName([
    { name: '  SALON', count: 1 },
    { name: 'salon ', count: 1 },
    { name: 'Salon', count: 1 }
  ]), 'Salon');
});

test('breaks a remaining tie the same way whatever the input order', () => {
  const variants = [{ name: 'Bureau', count: 2 }, { name: 'BUREAU', count: 2 }];
  assert.equal(pickDisplayName(variants), pickDisplayName([...variants].reverse()));
});

test('returns the normalized name, never an accident of spacing', () => {
  assert.equal(pickDisplayName([{ name: ' Cave  du  bas ', count: 1 }]), 'Cave du bas');
  assert.equal(locationKey(' Cave  du  BAS '), 'cave du bas');
});
