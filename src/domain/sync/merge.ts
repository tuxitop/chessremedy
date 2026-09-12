/**
 * Feature 016 — record-level merge (domain, pure).
 *
 * The ADR-017 JSON-level, record-by-record merge:
 *
 * - records are matched by their stable `keyOf`;
 * - one-sided records are accepted as-is;
 * - two-sided records are compared by their effective `updatedAt` and the
 *   newer wins;
 * - ties are broken by `deviceId` (lexicographically smaller wins) so both
 *   devices compute the same outcome;
 * - a tombstone wins while `deletedAt >= record.updatedAt`; a strictly newer
 *   record is a recreation and discards the tombstone.
 *
 * Everything is pure and deterministic: the output is ordered by record key
 * and the tie-break compares the same two device ids on both devices.
 */

import type { SettingRow } from '@/infrastructure/db/database';
import { SYNC_COLLECTION_BY_NAME } from './collections';
import { selectSyncedSettings } from './settings';
import type { DeviceId, SyncTombstone, TombstoneKind } from './types';

/** The accessors `mergeCollection` needs from a collection registry entry. */
export interface MergeAccessors<T> {
  readonly keyOf: (record: T) => string;
  readonly updatedAtOf: (record: T) => number;
  /** Kind of tombstone that deletes records of this collection, if any. */
  readonly tombstoneKind?: TombstoneKind | null;
}

/** Result of a collection merge. */
export interface MergeCollectionResult<T> {
  readonly records: readonly T[];
  /** Tombstone ids discarded because a newer record recreated the entity. */
  readonly discardedTombstoneIds: readonly string[];
}

/** Outcome of resolving a record's timestamp against a tombstone. */
export type TombstoneResolution =
  | { readonly action: 'keep' }
  | { readonly action: 'delete'; readonly tombstoneId: string }
  | { readonly action: 'recreate'; readonly tombstoneId: string };

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * ADR-017 tombstone rule. A tombstone with `deletedAt >= recordUpdatedAt`
 * deletes the record; a strictly newer record is a recreation and discards the
 * tombstone.
 */
export function resolveAgainstTombstone(
  recordUpdatedAt: number,
  tombstone: SyncTombstone | undefined,
): TombstoneResolution {
  if (tombstone === undefined) {
    return { action: 'keep' };
  }
  if (tombstone.deletedAt >= recordUpdatedAt) {
    return { action: 'delete', tombstoneId: tombstone.id };
  }
  return { action: 'recreate', tombstoneId: tombstone.id };
}

function indexByKey<T>(records: readonly T[], keyOf: (record: T) => string): Map<string, T> {
  const index = new Map<string, T>();
  for (const record of records) {
    index.set(keyOf(record), record);
  }
  return index;
}

function indexTombstones(
  tombstones: readonly SyncTombstone[],
  kind: TombstoneKind | null,
): Map<string, SyncTombstone> {
  const index = new Map<string, SyncTombstone>();
  for (const tombstone of tombstones) {
    if (kind !== null && tombstone.kind !== kind) {
      continue;
    }
    const existing = index.get(tombstone.recordId);
    if (existing === undefined || tombstone.deletedAt > existing.deletedAt) {
      index.set(tombstone.recordId, tombstone);
    }
  }
  return index;
}

function pickRecord<T>(
  local: T,
  remote: T,
  updatedAtOf: (record: T) => number,
  localDeviceId: DeviceId,
  remoteDeviceId: DeviceId,
): T {
  const localUpdatedAt = updatedAtOf(local);
  const remoteUpdatedAt = updatedAtOf(remote);
  if (localUpdatedAt > remoteUpdatedAt) return local;
  if (remoteUpdatedAt > localUpdatedAt) return remote;
  return localDeviceId <= remoteDeviceId ? local : remote;
}

/**
 * Merge one leaf collection. Tombstones are matched by `recordId` against the
 * records' `keyOf`; pass the full tombstone list and let the collection's
 * `tombstoneKind` (when set) filter it.
 */
export function mergeCollection<T>(
  local: readonly T[],
  remote: readonly T[],
  accessors: MergeAccessors<T>,
  tombstones: readonly SyncTombstone[],
  localDeviceId: DeviceId,
  remoteDeviceId: DeviceId,
): MergeCollectionResult<T> {
  const localByKey = indexByKey(local, accessors.keyOf);
  const remoteByKey = indexByKey(remote, accessors.keyOf);
  const tombstoneByRecordId = indexTombstones(tombstones, accessors.tombstoneKind ?? null);
  const keys = [...new Set([...localByKey.keys(), ...remoteByKey.keys()])].sort(compareStrings);

  const records: T[] = [];
  const discarded = new Set<string>();
  for (const key of keys) {
    const localRecord = localByKey.get(key);
    const remoteRecord = remoteByKey.get(key);
    let winner: T;
    if (localRecord !== undefined && remoteRecord !== undefined) {
      winner = pickRecord(
        localRecord,
        remoteRecord,
        accessors.updatedAtOf,
        localDeviceId,
        remoteDeviceId,
      );
    } else if (localRecord !== undefined) {
      winner = localRecord;
    } else if (remoteRecord !== undefined) {
      winner = remoteRecord;
    } else {
      continue;
    }

    const resolution = resolveAgainstTombstone(
      accessors.updatedAtOf(winner),
      tombstoneByRecordId.get(key),
    );
    if (resolution.action === 'delete') {
      continue;
    }
    if (resolution.action === 'recreate') {
      discarded.add(resolution.tombstoneId);
    }
    records.push(winner);
  }

  return { records, discardedTombstoneIds: [...discarded].sort(compareStrings) };
}

function pickTombstone(
  local: SyncTombstone,
  remote: SyncTombstone,
  localDeviceId: DeviceId,
  remoteDeviceId: DeviceId,
): SyncTombstone {
  if (local.deletedAt > remote.deletedAt) return local;
  if (remote.deletedAt > local.deletedAt) return remote;
  return localDeviceId <= remoteDeviceId ? local : remote;
}

/**
 * Merge the `tombstones` collection by `id` with the same LWW/tie-break rule
 * (`deletedAt` as the timestamp). One-sided tombstones are accepted as-is.
 */
export function mergeTombstones(
  local: readonly SyncTombstone[],
  remote: readonly SyncTombstone[],
  localDeviceId: DeviceId,
  remoteDeviceId: DeviceId,
): readonly SyncTombstone[] {
  const localById = new Map(local.map((tombstone) => [tombstone.id, tombstone]));
  const remoteById = new Map(remote.map((tombstone) => [tombstone.id, tombstone]));
  const ids = [...new Set([...localById.keys(), ...remoteById.keys()])].sort(compareStrings);

  const merged: SyncTombstone[] = [];
  for (const id of ids) {
    const localTombstone = localById.get(id);
    const remoteTombstone = remoteById.get(id);
    if (localTombstone !== undefined && remoteTombstone !== undefined) {
      merged.push(pickTombstone(localTombstone, remoteTombstone, localDeviceId, remoteDeviceId));
    } else if (localTombstone !== undefined) {
      merged.push(localTombstone);
    } else if (remoteTombstone !== undefined) {
      merged.push(remoteTombstone);
    }
  }
  return merged;
}

/**
 * Merge the `settings` collection through the canonical path after applying
 * the synced-settings allowlist, so a credential row can never win a merge.
 */
export function mergeSettings(
  local: readonly SettingRow[],
  remote: readonly SettingRow[],
  localDeviceId: DeviceId,
  remoteDeviceId: DeviceId,
): MergeCollectionResult<SettingRow> {
  return mergeCollection(
    selectSyncedSettings(local),
    selectSyncedSettings(remote),
    SYNC_COLLECTION_BY_NAME.settings,
    [],
    localDeviceId,
    remoteDeviceId,
  );
}
