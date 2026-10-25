import assert from 'node:assert/strict';
import test from 'node:test';
import { Types } from 'mongoose';
import { jsonPieces, jsonStream } from '../core/jsonStream';

// A backup written in pieces has to read exactly like the one-string export it replaces:
// same bytes, so nothing reading a backup can tell them apart.

const awkward = [
  { _id: new Types.ObjectId('6ab55b28a380d85900286679'), title: 'Été « quoted »   line', added_at: new Date('2026-01-18T01:15:34.866Z') },
  { nested: { deep: [1, [2, []], {}], empty: {} }, gone: undefined, fn: () => 1 },
  null,
  'plain text',
  42,
  [],
  { emoji: '\u{1F3B5}', tracklist: [{ position: 'A1', tags: [] }] }
];

async function written(document: Record<string, unknown>): Promise<string> {
  let text = '';
  for await (const piece of jsonPieces(document)) text += piece;
  return text;
}

async function* records(list: any[]) {
  for (const record of list) yield record;
}

test('a document with a streamed list reads exactly like JSON.stringify of the whole', async () => {
  const meta = { version: '4.0.0', date: new Date('2026-10-25T00:00:00Z') };
  const expected = JSON.stringify({ users: [{ name: 'a' }], albums: awkward, logs: [], metadata: meta }, null, 2);
  assert.equal(await written({ users: [{ name: 'a' }], albums: () => records(awkward), logs: () => records([]), metadata: meta }), expected);
});

test('what JSON.stringify leaves out or writes as null stays so', async () => {
  const withHoles = [undefined, () => 1, { a: undefined }];
  assert.equal(
    await written({ skipped: undefined, list: () => records(withHoles), nothing: null }),
    JSON.stringify({ skipped: undefined, list: withHoles, nothing: null }, null, 2)
  );
  assert.equal(await written({}), JSON.stringify({}, null, 2));
  assert.equal(await written({ only: undefined }), JSON.stringify({ only: undefined }, null, 2));
});

test('the stream gives UTF-8 bytes, whole characters included across chunk edges', async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ i, title: `Été ${i} \u{1F3B5}` }));
  const chunks: Buffer[] = [];
  for await (const chunk of jsonStream({ albums: () => records(many) }, 100)) {
    assert.ok(Buffer.isBuffer(chunk), 'chunks are bytes, so a ZIP entry counts its size right');
    chunks.push(chunk);
  }
  assert.ok(chunks.length > 1);
  assert.equal(Buffer.concat(chunks).toString('utf8'), JSON.stringify({ albums: many }, null, 2));
});
