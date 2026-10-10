import assert from 'node:assert/strict';
import test from 'node:test';
import { searchWithGuess } from '../core/helpers';

// A source that only knows the given queries, and records what it was asked.
function sourceKnowing(known: Record<string, string[]>) {
  const asked: string[] = [];
  const search = async (query: string) => { asked.push(query); return known[query] || []; };
  return { asked, search };
}

test('a catalog that matches the creator is answered on the first query', async () => {
  const { asked, search } = sourceKnowing({ 'The Dark Side of the Moon Pink Floyd': ['r1'] });
  const attempt = await searchWithGuess({ title: 'The Dark Side of the Moon', creator: 'Pink Floyd' }, search);
  assert.deepEqual(attempt.results, ['r1']);
  assert.equal(attempt.query, 'The Dark Side of the Moon Pink Floyd');
  assert.deepEqual(asked, ['The Dark Side of the Moon Pink Floyd']);
});

test('a provider that matches the title alone still finds it, even under three words', async () => {
  const { asked, search } = sourceKnowing({ 'Inception': ['m1'] });
  const attempt = await searchWithGuess({ title: 'Inception', creator: 'Christopher Nolan' }, search);
  assert.deepEqual(attempt.results, ['m1']);
  assert.equal(attempt.query, 'Inception');
  assert.deepEqual(asked, ['Inception Christopher Nolan', 'Inception']);
});

test('without a creator the title is searched directly, then in shorter forms', async () => {
  const { asked, search } = sourceKnowing({ 'Super Mario Bros': ['g1'] });
  const attempt = await searchWithGuess({ title: 'Super Mario Bros Wonder Edition', creator: '' }, search);
  assert.deepEqual(attempt.results, ['g1']);
  assert.equal(asked[0], 'Super Mario Bros Wonder Edition');
  assert.equal(attempt.query, 'Super Mario Bros');
});
