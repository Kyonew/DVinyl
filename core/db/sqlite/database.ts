/**
 * The SQLite file the stores keep their records in.
 *
 * Every store is a table of records held as JSON documents, one row each: the id, the
 * document, and the value it is partitioned by (the collection an item belongs to), so
 * a lookup scoped to one collection reads that collection's rows only. Filters are then
 * evaluated on the documents themselves (core/db/match.ts).
 *
 * The documents are JSON that keeps ids and dates as such: `{"$oid": "..."}` and
 * `{"$date": "..."}`, read back into the objects they were written from.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import type { Filter } from '../filter';

let database: Database.Database | null = null;

// Ids are compared as text all the time in memory; each id keeps its text once computed.
(Types.ObjectId as any).cacheHexString = true;

export function openDatabase(file: string): void {
  if (database) database.close();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = OFF');
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}

function handle(): Database.Database {
  if (!database) throw new Error('The SQLite store is not open (see db.connect).');
  return database;
}

export function encode(doc: any): string {
  return JSON.stringify(doc, function (this: any, key: string, value: any) {
    const raw = key === '' ? value : this[key];
    if (raw instanceof Date) return { $date: raw.toISOString() };
    if (raw && typeof raw === 'object' && raw._bsontype === 'ObjectId') return { $oid: String(raw) };
    if (raw instanceof Map) return Object.fromEntries(raw);
    return value;
  });
}

export function decode(text: string): any {
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === '$oid') return new Types.ObjectId(value.$oid);
      if (keys.length === 1 && keys[0] === '$date') return new Date(value.$date);
    }
    return value;
  });
}

const idText = (value: any): string => String(value?._id ?? value);

/**
 * One table of records. `partition` names the field rows are grouped by, when the
 * records have one every lookup is scoped to.
 *
 * The table is read once, then served from memory: the records stay decoded, and every
 * write goes to the file and to memory together. Only this process writes the file, so
 * the two never part. What a caller is handed out of memory is not to be changed in
 * place: the engine copies a record before writing to it (see engine.ts).
 */
export class Table {
  private ready = false;
  private rows: Map<string, any> | null = null;
  private byPart = new Map<string | null, Set<string>>();
  // Undo entries of the transaction under way, replayed backwards if it fails.
  private undo: (() => void)[] | null = null;

  constructor(readonly name: string, readonly partition?: string) {}

  private db(): Database.Database {
    const db = handle();
    if (!this.ready) {
      db.exec(`CREATE TABLE IF NOT EXISTS "${this.name}" (
        id TEXT PRIMARY KEY,
        part TEXT,
        doc TEXT NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS "${this.name}_part" ON "${this.name}" (part)`);
      this.ready = true;
    }
    return db;
  }

  private partOf(doc: any): string | null {
    if (!this.partition) return null;
    const value = doc[this.partition];
    return value === undefined || value === null ? null : idText(value);
  }

  private memory(): Map<string, any> {
    if (!this.rows) {
      const rows = this.db().prepare(`SELECT id, part, doc FROM "${this.name}" ORDER BY rowid`).all() as any[];
      this.rows = new Map();
      this.byPart = new Map();
      for (const row of rows) this.remember(row.id, decode(row.doc));
    }
    return this.rows;
  }

  private remember(id: string, doc: any): void {
    this.rows!.set(id, doc);
    const part = this.partOf(doc);
    if (!this.byPart.has(part)) this.byPart.set(part, new Set());
    this.byPart.get(part)!.add(id);
  }

  private forget(id: string): void {
    const doc = this.rows!.get(id);
    if (doc === undefined) return;
    this.byPart.get(this.partOf(doc))?.delete(id);
    this.rows!.delete(id);
  }

  // Puts `doc` in memory under `id`, or takes it out (null). A record changed in place
  // keeps its position, like a row the file updates keeps its own: the order records are
  // read in has to be the same before and after a restart.
  private put(id: string, doc: any | null): void {
    const before = this.rows!.get(id);
    if (doc === null) {
      this.forget(id);
      return;
    }
    if (before === undefined) {
      this.remember(id, doc);
      return;
    }
    const oldPart = this.partOf(before);
    const newPart = this.partOf(doc);
    this.rows!.set(id, doc);
    if (oldPart !== newPart) {
      this.byPart.get(oldPart)?.delete(id);
      if (!this.byPart.has(newPart)) this.byPart.set(newPart, new Set());
      this.byPart.get(newPart)!.add(id);
    }
  }

  // Changes memory, keeping how to take the change back while a transaction is open.
  private change(id: string, doc: any | null): void {
    const rows = this.memory();
    if (this.undo) {
      const before = rows.get(id);
      this.undo.push(() => this.put(id, before === undefined ? null : before));
    }
    this.put(id, doc);
  }

  /**
   * The rows a filter can only be about: those of the ids it pins, or of the partition
   * value it pins, every row otherwise. In the order they were written. The filter itself
   * still has to be applied to them, and they must not be changed in place.
   */
  candidates(filter: Filter): any[] {
    const rows = this.memory();
    const pinned = pinnedKeys(filter, this.partition);
    if (pinned.ids) return pinned.ids.map(id => rows.get(id)).filter(doc => doc !== undefined);
    if (pinned.part !== undefined) {
      const ids = this.byPart.get(pinned.part);
      return ids ? [...ids].map(id => rows.get(id)) : [];
    }
    return [...rows.values()];
  }

  get(id: string): any | null {
    return this.memory().get(id) ?? null;
  }

  insert(doc: any): void {
    const id = idText(doc._id);
    this.db().prepare(`INSERT INTO "${this.name}" (id, part, doc) VALUES (?, ?, ?)`).run(id, this.partOf(doc), encode(doc));
    this.change(id, doc);
  }

  replace(doc: any): void {
    const id = idText(doc._id);
    this.db().prepare(`UPDATE "${this.name}" SET part = ?, doc = ? WHERE id = ?`).run(this.partOf(doc), encode(doc), id);
    this.change(id, doc);
  }

  remove(ids: string[]): number {
    if (ids.length === 0) return 0;
    const statement = this.db().prepare(`DELETE FROM "${this.name}" WHERE id = ?`);
    let removed = 0;
    this.transaction(() => {
      for (const id of ids) {
        const changes = statement.run(id).changes;
        if (changes > 0) this.change(id, null);
        removed += changes;
      }
    });
    return removed;
  }

  /** Runs `work` as one transaction: all of its writes land, in the file and in memory, or none. */
  transaction<T>(work: () => T): T {
    if (this.undo) return work();
    this.memory();
    this.undo = [];
    try {
      const result = this.db().transaction(work)();
      this.undo = null;
      return result;
    } catch (err) {
      const steps = this.undo || [];
      this.undo = null;
      for (const step of steps.reverse()) step();
      throw err;
    }
  }
}

/**
 * The keys a filter pins for every record it can match: the ids it limits itself to, or
 * the partition value, read off the conditions it requires at its top level.
 */
function pinnedKeys(filter: Filter, partition?: string): { ids?: string[] | undefined; part?: string | null | undefined } {
  const required = filter.op === 'and' ? filter.filters : [filter];
  let ids: string[] | undefined;
  let part: string | null | undefined;
  for (const condition of required) {
    if (condition.op === 'eq' && condition.field === '_id' && condition.value !== null) {
      const id = idText(condition.value);
      ids = ids ? ids.filter(x => x === id) : [id];
    } else if (condition.op === 'in' && condition.field === '_id') {
      const list = condition.values.filter(v => v !== null).map(idText);
      ids = ids ? ids.filter(x => list.includes(x)) : list;
    } else if (partition && condition.op === 'eq' && condition.field === partition && condition.value !== null) {
      part = idText(condition.value);
    }
  }
  return { ids, part };
}
