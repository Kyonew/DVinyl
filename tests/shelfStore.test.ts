import '../test/helpers/env';
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { startDb, stopDb, clearDb } from '../test/helpers/db';
import Item from '../models/Item';
import Furniture from '../models/Furniture';
import { createFurniture, moveCell, saveFurniture } from '../core/shelfStore';

before(async () => { await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

/** A piece with cells given as [name, capacity?] pairs in reading order. */
async function piece(over: Record<string, any> = {}) {
  const columns = over.columns ?? 4;
  const cells = (over.cells ?? []).map((entry: any, index: number) => ({
    name: entry[0], key: entry[0].toLocaleLowerCase(), row: Math.floor(index / columns),
    column: index % columns, capacity: entry[1] ?? 0
  }));
  return Furniture.create({
    collection: over.collection, name: over.name ?? 'Billy', layout: over.layout ?? 'cubes',
    columns, rows: over.rows ?? Math.max(1, Math.ceil(cells.length / columns)),
    order: over.order ?? 100, cells
  });
}

const itemAt = (collection: any, location: string, title = 'Thing') =>
  Item.create({ collection, owner: new mongoose.Types.ObjectId(), title, location });

test('saveFurniture renames a shelf and its items follow', async () => {
  const collection = new mongoose.Types.ObjectId();
  const created = await piece({ collection, cells: [['Salon'], ['Vitrine']] });
  await itemAt(collection, 'Salon');

  const verdict = await saveFurniture(collection, created, {
    name: 'Billy', columns: 4, rows: 3,
    cells: [{ name: 'Living room', from: 'salon' }, { name: 'Vitrine' }]
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.renamed, 1);
  assert.equal(verdict.moved, 1);
  assert.equal(await Item.countDocuments({ collection, location: 'Living room' }), 1);
});

test('saveFurniture swaps two names in one pass', async () => {
  const collection = new mongoose.Types.ObjectId();
  const created = await piece({ collection, cells: [['Salon'], ['Cave']] });
  await itemAt(collection, 'Salon');
  await itemAt(collection, 'Cave');

  const verdict = await saveFurniture(collection, created, {
    name: 'Billy', columns: 4, rows: 3,
    cells: [{ name: 'Cave', from: 'salon' }, { name: 'Salon', from: 'cave' }]
  });
  assert.equal(verdict.ok, true);
  // The item that was in "Salon" is now in "Cave", and the one in "Cave" now in "Salon".
  const swapped = await Item.countDocuments({ collection, location: 'Cave' });
  assert.equal(swapped, 1);
  assert.equal(await Item.countDocuments({ collection, location: 'Salon' }), 1);
});

test('saveFurniture refuses a repeated shelf, in the piece and elsewhere', async () => {
  const collection = new mongoose.Types.ObjectId();
  const a = await piece({ collection, cells: [['Salon']] });
  await piece({ collection, name: 'Kallax', cells: [['Cave']] });

  const repeated = await saveFurniture(collection, a, { name: 'A', columns: 4, rows: 3, cells: [{ name: 'Salon' }, { name: 'salon' }] });
  assert.deepEqual(repeated, { ok: false, error: 'duplicate_shelf', shelf: 'salon' });

  const elsewhere = await saveFurniture(collection, a, { name: 'A', columns: 4, rows: 3, cells: [{ name: 'Cave' }] });
  assert.equal(elsewhere.ok, false);
  assert.equal((elsewhere as any).error, 'shelf_elsewhere');
  assert.equal((elsewhere as any).furniture, 'Kallax');
});

test('saveFurniture drops blank cells, reflows and grows rows', async () => {
  const collection = new mongoose.Types.ObjectId();
  const created = await piece({ collection, cells: [] });

  const verdict = await saveFurniture(collection, created, {
    name: 'Billy', columns: 2, rows: 1,
    cells: [{ name: 'A' }, { name: '  ' }, { name: 'B', capacity: 999999 }, { name: 'C' }]
  });
  assert.equal(verdict.ok, true);
  const saved = verdict.furniture as any;
  assert.deepEqual(saved.cells.map((c: any) => [c.name, c.row, c.column]), [['A', 0, 0], ['B', 0, 1], ['C', 1, 0]]);
  assert.equal(saved.columns, 2);
  assert.equal(saved.rows, 2);            // grown to hold row 1
  assert.equal(saved.cells[1].capacity, 100000); // clamped
});

test('saveFurniture wants a name', async () => {
  const collection = new mongoose.Types.ObjectId();
  const created = await piece({ collection, cells: [] });
  assert.deepEqual(await saveFurniture(collection, created, { name: '   ' }), { ok: false, error: 'name_required' });
});

test('createFurniture defaults its order after the collection and wants a name', async () => {
  const collection = new mongoose.Types.ObjectId();
  await piece({ collection, cells: [] });

  const missing = await createFurniture(collection, { name: '' }, new mongoose.Types.ObjectId());
  assert.deepEqual(missing, { ok: false, error: 'name_required' });

  const verdict = await createFurniture(collection, { name: 'Kallax', layout: 'rows' }, new mongoose.Types.ObjectId());
  assert.equal(verdict.ok, true);
  const created = verdict.furniture as any;
  assert.equal(created.layout, 'rows');
  assert.equal(created.order, 101);       // 100 + one existing piece
  assert.deepEqual(created.cells, []);
});

test('moveCell carries a shelf to another piece and packs the source', async () => {
  const collection = new mongoose.Types.ObjectId();
  const source = await piece({ collection, cells: [['Salon'], ['Cave']] });
  const target = await piece({ collection, name: 'Kallax', cells: [] });

  const verdict = await moveCell(collection, 'salon', target._id);
  assert.deepEqual(verdict, { ok: true, moved: true });

  const freshSource: any = await Furniture.findById(source._id).lean();
  assert.deepEqual(freshSource.cells.map((c: any) => [c.name, c.row, c.column]), [['Cave', 0, 0]]);
  const freshTarget: any = await Furniture.findById(target._id).lean();
  assert.deepEqual(freshTarget.cells.map((c: any) => c.name), ['Salon']);
});

test('moveCell is a no-op to the same piece and refuses a missing shelf', async () => {
  const collection = new mongoose.Types.ObjectId();
  const created = await piece({ collection, cells: [['Salon']] });
  assert.deepEqual(await moveCell(collection, 'salon', created._id), { ok: true, moved: false });
  assert.deepEqual(await moveCell(collection, 'nope', created._id), { ok: false, error: 'not_found' });
  assert.deepEqual(await moveCell(collection, '', created._id), { ok: false, error: 'bad_request' });
});
