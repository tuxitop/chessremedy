/**
 * Tombstones repository (Feature 016, schema v12).
 *
 * Persists the deletion records that propagate a user deletion between devices
 * (ADR-016/ADR-017). Only the two user-deletable top-level entities are
 * tombstoned — `game` and `trainingSet`; their derived rows (analyses,
 * candidates, puzzles, attempts, cycles) are removed by the ownership cascade
 * on every device, so they need no tombstone (spec "Deletion & derived state").
 *
 * The row is the domain `SyncTombstone` stored verbatim (`id` is the
 * deterministic `tombstoneId(kind, recordId)`), keyed by `id` with `kind`,
 * `recordId` and `deletedAt` indexed for merge/cascade scans.
 */

import type { SyncTombstone, TombstoneKind } from '@/domain/sync';
import { db, type ChessRemedyDatabase } from './database';

/** Persisted tombstone row: the domain `SyncTombstone` stored as-is. */
export type SyncTombstoneRow = SyncTombstone;

export interface TombstonesRepository {
  /** One tombstone by its deterministic id; `undefined` when absent. */
  get(id: string): Promise<SyncTombstoneRow | undefined>;
  /** Insert or replace one tombstone. */
  put(row: SyncTombstoneRow): Promise<void>;
  /** Insert or replace many tombstones in one call (bulk deletion). */
  putMany(rows: readonly SyncTombstoneRow[]): Promise<void>;
  /** Every tombstone, ordered by `deletedAt` then id (deterministic). */
  listAll(): Promise<SyncTombstoneRow[]>;
  /** Every tombstone of one kind, ordered by `deletedAt` then id. */
  listForKind(kind: TombstoneKind): Promise<SyncTombstoneRow[]>;
  /** Remove the given ids; idempotent for absent ids. */
  remove(ids: readonly string[]): Promise<void>;
  /** Remove every tombstone (reset). */
  clear(): Promise<void>;
}

function compareTombstones(a: SyncTombstoneRow, b: SyncTombstoneRow): number {
  return a.deletedAt - b.deletedAt || a.id.localeCompare(b.id);
}

export class DexieTombstonesRepository implements TombstonesRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async get(id: string): Promise<SyncTombstoneRow | undefined> {
    return this.database.syncTombstones.get(id);
  }

  async put(row: SyncTombstoneRow): Promise<void> {
    await this.database.syncTombstones.put(row);
  }

  async putMany(rows: readonly SyncTombstoneRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.database.syncTombstones.bulkPut([...rows]);
  }

  async listAll(): Promise<SyncTombstoneRow[]> {
    const rows = await this.database.syncTombstones.toArray();
    return rows.sort(compareTombstones);
  }

  async listForKind(kind: TombstoneKind): Promise<SyncTombstoneRow[]> {
    const rows = await this.database.syncTombstones.where('kind').equals(kind).toArray();
    return rows.sort(compareTombstones);
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.database.syncTombstones.bulkDelete([...ids]);
  }

  async clear(): Promise<void> {
    await this.database.syncTombstones.clear();
  }
}

export const tombstonesRepository: TombstonesRepository = new DexieTombstonesRepository();
