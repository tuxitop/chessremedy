/**
 * Feature 016 — tombstone construction (domain, pure).
 *
 * A tombstone is the deletion record that propagates a user deletion between
 * devices (ADR-016, ADR-017). `id` is the deterministic projection of the
 * deleted entity, so two devices deleting the same record mint the same id and
 * `mergeTombstones` can match them by id.
 */

import type { DeviceId, SyncTombstone, TombstoneKind } from './types';

/** Deterministic tombstone id: `<kind>:<recordId>`. */
export function tombstoneId(kind: TombstoneKind, recordId: string): string {
  return `${kind}:${recordId}`;
}

/** Build a tombstone for a deleted top-level entity. */
export function makeTombstone(
  kind: TombstoneKind,
  recordId: string,
  deletedAt: number,
  deviceId: DeviceId,
): SyncTombstone {
  return { id: tombstoneId(kind, recordId), kind, recordId, deletedAt, deviceId };
}
