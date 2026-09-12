import type Dexie from 'dexie';

/**
 * Schema v12 — Feature 016 synchronization (additive).
 *
 * Adds three non-domain stores and backfills the two mutable synced rows with
 * their new ADR-017 merge timestamp (`updatedAt`):
 *
 * - `syncState` — non-synced key/value rows (deviceId, provider, tokens, rev,
 *   hashes, pending, status, lastError). Never in the envelope.
 * - `syncTombstones` — deletion records for the two user-deletable top-level
 *   entities (`game`/`trainingSet`), keyed by the deterministic
 *   `<kind>:<recordId>` id.
 * - `syncBackups` — non-synced timestamped remote payloads kept for recovery.
 *
 * The upgrade backfills `puzzleCandidates.updatedAt` from `createdAt` and
 * `trainingCycles.updatedAt` from `startedAt`. It never reads the existing
 * timestamp, so it is idempotent: a re-run leaves an already-migrated row
 * byte-identical. Immutable rows keep their creation timestamp as their
 * effective merge time (G2), so no other field changes.
 */
export function applyV12Schema(db: Dexie): void {
  db.version(12)
    .stores({
      syncState: '&key',
      syncTombstones: '&id, kind, recordId, deletedAt',
      syncBackups: '&id, createdAt',
    })
    .upgrade(async (tx) => {
      const candidates = await tx.table('puzzleCandidates').toArray();
      const upgradedCandidates = candidates.map(
        (row: { createdAt: number; updatedAt?: number }) => ({
          ...row,
          updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : row.createdAt,
        }),
      );
      if (upgradedCandidates.length > 0) {
        await tx.table('puzzleCandidates').bulkPut(upgradedCandidates);
      }

      const cycles = await tx.table('trainingCycles').toArray();
      const upgradedCycles = cycles.map((row: { startedAt: number; updatedAt?: number }) => ({
        ...row,
        updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : row.startedAt,
      }));
      if (upgradedCycles.length > 0) {
        await tx.table('trainingCycles').bulkPut(upgradedCycles);
      }
    });
}
