import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeCompartment, pileUp, spineTone, SPINE_TONES } from '../core/spine';

const spines = (...widths: number[]) => widths.map((width, i) => ({ id: i, spine: { width } }));

test('a compartment within its capacity stands upright and leans its last item', () => {
  const { standing, pile, lean } = arrangeCompartment(spines(20, 20, 20), 5);
  assert.equal(standing.length, 3);
  assert.equal(pile.length, 0);
  assert.equal(lean, true);
});

test('a full compartment does not lean', () => {
  assert.equal(arrangeCompartment(spines(20, 20, 20), 3).lean, false);
});

test('a single item has nothing to lean on', () => {
  assert.equal(arrangeCompartment(spines(20), 5).lean, false);
});

test('a compartment without a capacity never piles and always leans', () => {
  const { standing, pile, lean } = arrangeCompartment(spines(20, 20, 20, 20), 0);
  assert.equal(standing.length, 4);
  assert.equal(pile.length, 0);
  assert.equal(lean, true);
});

test('what goes past the capacity is laid in a pile, keeping the page order', () => {
  const { standing, pile, lean } = arrangeCompartment(spines(36, 36, 36, 36), 2);
  assert.deepEqual(standing.map(s => s.id), [0, 1]);
  assert.deepEqual(pile.map(s => s.id), [2, 3]);
  assert.equal(lean, false);
});

test('a pile stops before it rises above the tallest spine, the rest keeps standing', () => {
  // Boxes 81px thick: two of them is already 162, a third would reach 243.
  const { standing, pile } = arrangeCompartment(spines(81, 81, 81, 81, 81), 1);
  assert.equal(pile.length, 2);
  assert.equal(standing.length, 3);
});

test('piles group by kind of object, in order of first appearance', () => {
  const items = [
    { kind: 'cd', spine: { width: 25 } }, { kind: 'lp', spine: { width: 20 } },
    { kind: 'cd', spine: { width: 25 } }, { kind: 'lp', spine: { width: 20 } }
  ];
  const piles = pileUp(items, item => item.kind);
  assert.deepEqual(piles.map(p => p.map(i => i.kind)), [['cd', 'cd'], ['lp', 'lp']]);
});

test('a pile that would grow too tall starts a new one', () => {
  const items = Array.from({ length: 10 }, () => ({ kind: 'book', spine: { width: 36 } }));
  const piles = pileUp(items, item => item.kind);
  assert.deepEqual(piles.map(p => p.length), [5, 5]);
});

test('a tone is stable, in range, and ignores case and stray spaces', () => {
  const tone = spineTone('Moon Safari');
  assert.ok(tone >= 0 && tone < SPINE_TONES);
  assert.equal(spineTone('  moon safari '), tone);
  assert.equal(spineTone(undefined), spineTone(''));
});
