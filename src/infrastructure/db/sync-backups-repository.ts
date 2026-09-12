/**
 * Sync-backups repository (Feature 016, schema v12).
 *
 * Persists timestamped remote payloads kept for recovery (ADR-017 step 4e):
 * when the bounded 409 conflict retry is exhausted the remote bytes are stored
 * here before the merged file replaces them. These rows are **non-synced** —
 * they are a local recovery artifact and never part of the envelope.
 */

import { db, type ChessRemedyDatabase } from './database';

/** Optional provenance of a stored remote backup payload. */
export interface SyncBackupMeta {
  /** Remote `rev` the payload was downloaded at, when known. */
  readonly rev?: string;
  /** Remote `content_hash` of the payload, when known. */
  readonly contentHash?: string;
  /** Why the backup was taken (e.g. `conflict-exhausted`). */
  readonly reason?: string;
}

/** One persisted non-synced backup row. */
export interface SyncBackupRow {
  /** Stable backup id (e.g. `backup-<ISO>`). */
  readonly id: string;
  /** Epoch millis the backup was captured. */
  readonly createdAt: number;
  /** The gzip envelope bytes downloaded from the remote. */
  readonly payload: Uint8Array;
  readonly meta?: SyncBackupMeta;
}

export interface SyncBackupsRepository {
  /** One backup by id; `undefined` when absent. */
  get(id: string): Promise<SyncBackupRow | undefined>;
  /** Every backup, newest first (deterministic ties by id). */
  list(): Promise<SyncBackupRow[]>;
  /** Insert or replace one backup row. */
  add(row: SyncBackupRow): Promise<void>;
  /** Remove the given ids; idempotent for absent ids. */
  remove(ids: readonly string[]): Promise<void>;
  /** Remove every backup (reset). */
  clear(): Promise<void>;
}

export class DexieSyncBackupsRepository implements SyncBackupsRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async get(id: string): Promise<SyncBackupRow | undefined> {
    return this.database.syncBackups.get(id);
  }

  async list(): Promise<SyncBackupRow[]> {
    const rows = await this.database.syncBackups.toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }

  async add(row: SyncBackupRow): Promise<void> {
    await this.database.syncBackups.put(row);
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.database.syncBackups.bulkDelete([...ids]);
  }

  async clear(): Promise<void> {
    await this.database.syncBackups.clear();
  }
}

export const syncBackupsRepository: SyncBackupsRepository = new DexieSyncBackupsRepository();
