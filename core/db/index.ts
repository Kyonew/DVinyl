/**
 * The storage the core reads and writes through, one store per kind of record. Plain
 * objects, so a test can stand in for one of their functions.
 */

import * as items from './items';

export const db = { items: { ...items } };
