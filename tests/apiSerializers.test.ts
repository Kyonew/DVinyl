import assert from 'node:assert/strict';
import test from 'node:test';
import { furnitureToApi } from '../core/apiSerializers';

test('furnitureToApi maps a piece and its per-cell counts', () => {
  const piece = {
    _id: 'abc',
    name: 'Billy',
    layout: 'cubes',
    columns: 4,
    rows: 3,
    order: 100,
    cells: [
      { name: 'Salon', key: 'salon', row: 0, column: 1, capacity: 40 },
      { name: 'Vitrine', key: 'vitrine', row: 1, column: 0 }
    ]
  };

  assert.deepEqual(furnitureToApi(piece, new Map([['Salon', 12]])), {
    id: 'abc',
    name: 'Billy',
    layout: 'cubes',
    columns: 4,
    rows: 3,
    order: 100,
    cells: [
      { name: 'Salon', key: 'salon', row: 0, column: 1, capacity: 40, count: 12 },
      { name: 'Vitrine', key: 'vitrine', row: 1, column: 0, capacity: 0, count: 0 }
    ]
  });
});
