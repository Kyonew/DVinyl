/**
 * A store for one kind of record (accounts, collections, settings...), read and written
 * with core filters (core/db/filter.ts) and patches (core/db/patch.ts). Records come
 * back as plain objects.
 */

import type { Filter, Scalar, Sort } from './filter';
import type { Patch } from './patch';

export interface ReadOptions {
  sort?: Sort;
  skip?: number;
  limit?: number;
  /** Only these fields (plus the id) on each record. */
  fields?: string[];
  /** Fill in what the record type declares a default for and the record does not hold. */
  defaults?: boolean;
}

export interface UpdateOptions {
  /** Create the record from the filter and the patch when none matches. */
  upsert?: boolean;
}

export type WriteResult = { matched: number; modified: number; upserted: boolean };

export interface RecordStore {
  find(filter: Filter, options?: ReadOptions): Promise<any[]>;
  findOne(filter: Filter, options?: Omit<ReadOptions, 'skip' | 'limit'>): Promise<any | null>;
  findById(id: string, options?: Pick<ReadOptions, 'fields' | 'defaults'>): Promise<any | null>;
  count(filter: Filter): Promise<number>;
  exists(filter: Filter): Promise<boolean>;
  /** Stores a new record, checked against its type, and returns it as stored. */
  create(record: Record<string, any>): Promise<any>;
  updateOne(filter: Filter, patch: Patch, options?: UpdateOptions): Promise<WriteResult>;
  updateMany(filter: Filter, patch: Patch): Promise<WriteResult>;
  /** Changes the first matching record and returns it as it is afterwards, or null. */
  updateAndGet(filter: Filter, patch: Patch, options?: UpdateOptions): Promise<any | null>;
  /**
   * Changes one record of a list of records on the first matching record: the first
   * entry whose `where` fields hold the given values. `own` changes the record itself
   * in the same write.
   */
  updateListRecord(
    filter: Filter,
    entry: { list: string; where: Record<string, Scalar>; set?: Record<string, any>; unset?: string[] },
    own?: Patch
  ): Promise<WriteResult>;
  deleteOne(filter: Filter): Promise<number>;
  deleteMany(filter: Filter): Promise<number>;
}
