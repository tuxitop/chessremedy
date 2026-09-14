import type Dexie from 'dexie';

/**
 * Schema v13 — Feature 020 individual review scheduling (additive).
 *
 * Adds the derived `puzzleSchedules` projection store (ADR-035), keyed by the
 * owning `puzzleId` and indexed by `dueAt` for the bounded due query. The
 * store starts empty (no backfill): it is a rebuildable projection of the
 * immutable `puzzleAttempts` log, never authoritative and never synced
 * (ADR-016 envelope exclusion, like the ADR-018 engine cache).
 *
 * Existing stores are unchanged; an existing v12 installation opens with no
 * data loss.
 */
export function applyV13Schema(db: Dexie): void {
  db.version(13).stores({ puzzleSchedules: '&puzzleId, dueAt' });
}
