/**
 * Sync-state repository (Feature 016, schema v12).
 *
 * Persists the non-synced key/value rows the sync engine needs across sessions:
 * the stable `deviceId` (ADR-017 tie-break), the connected provider, OAuth
 * tokens + expiry, the remote `rev`/`content_hash` bookkeeping, the persisted
 * pending/dirty flag and the last `SyncStatus`/error. These rows are
 * **never** part of the sync envelope and never enter `settings` (spec
 * "Deletion & derived state"; ADR-015 secrets stay out of the payload).
 *
 * A generic key/value shape keeps the engine free to add bookkeeping keys
 * without a schema bump; `getOrCreateDeviceId` lazily mints and stores a stable
 * UUID (the only row this module creates on its own).
 */

import type { DeviceId } from '@/domain/sync';
import { db, type ChessRemedyDatabase } from './database';

/** One persisted non-synced sync-state row. */
export interface SyncStateRow<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly updatedAt: number;
}

/**
 * The known `syncState` keys. The table is a generic key/value store, so the
 * engine may persist additional keys; these are the ones the plan names.
 */
export const SYNC_STATE_KEYS = {
  deviceId: 'deviceId',
  provider: 'provider',
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  tokenExpiresAt: 'tokenExpiresAt',
  lastRemoteRev: 'lastRemoteRev',
  lastRemoteContentHash: 'lastRemoteContentHash',
  lastPushedHash: 'lastPushedHash',
  lastSyncedAt: 'lastSyncedAt',
  pending: 'pending',
  status: 'status',
  lastError: 'lastError',
} as const;

export type SyncStateKey = (typeof SYNC_STATE_KEYS)[keyof typeof SYNC_STATE_KEYS];

export interface SyncStateRepository {
  /** The value stored under `key`, or `undefined` when absent. */
  get<T>(key: string): Promise<T | undefined>;
  /** Insert or replace one key/value row (stamps `updatedAt`). */
  set<T>(key: string, value: T): Promise<void>;
  /**
   * Merge `partial` into the existing object value at `key`. Returns the merged
   * value, or `undefined` when the key is absent (no row is created).
   */
  patch<T extends object>(key: string, partial: Partial<T>): Promise<T | undefined>;
  /** Remove one row; idempotent when absent. */
  remove(key: string): Promise<void>;
  /** Remove every sync-state row (disconnect/reset). */
  clear(): Promise<void>;
  /**
   * The stable device id, minted once via `crypto.randomUUID()` and persisted
   * on first use. Safe to call even when sync is unconfigured.
   */
  getOrCreateDeviceId(): Promise<DeviceId>;
}

export class DexieSyncStateRepository implements SyncStateRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const row = await this.database.syncState.get(key);
    return row?.value as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.database.syncState.put({ key, value, updatedAt: Date.now() });
  }

  async patch<T extends object>(key: string, partial: Partial<T>): Promise<T | undefined> {
    const existing = await this.database.syncState.get(key);
    if (!existing) {
      return undefined;
    }
    const value = { ...(existing.value as T), ...partial };
    await this.database.syncState.put({ key, value, updatedAt: Date.now() });
    return value;
  }

  async remove(key: string): Promise<void> {
    await this.database.syncState.delete(key);
  }

  async clear(): Promise<void> {
    await this.database.syncState.clear();
  }

  async getOrCreateDeviceId(): Promise<DeviceId> {
    const existing = await this.get<DeviceId>(SYNC_STATE_KEYS.deviceId);
    if (existing !== undefined && existing.length > 0) {
      return existing;
    }
    const deviceId = crypto.randomUUID();
    await this.set(SYNC_STATE_KEYS.deviceId, deviceId);
    return deviceId;
  }
}

export const syncStateRepository: SyncStateRepository = new DexieSyncStateRepository();
