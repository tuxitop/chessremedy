import type Dexie from 'dexie';

/**
 * Schema v10 — Feature 013 (tactical training cycles) set/cycle tables.
 *
 * Purely additive over v9 (`settings`, `games`, `importJobs`, `analysisJobs`,
 * `analyses`, `positionAnalysisCache`, `analysisSummaries`,
 * `puzzleCandidates`, `puzzles`, `puzzleAttempts`). Both new tables start
 * empty, so no `upgrade` backfill is needed:
 *
 * - `trainingSets` — the fixed, user-owned training collections
 *   (`TacticalTrainingSetRow`). `status` serves the active/archived list read
 *   and `createdAt` the deterministic listing order.
 * - `trainingCycles` — one row per pass through a set (`TrainingCycleRow`).
 *   The compound `&[trainingSetId+cycleNumber]` is the spec's required unique
 *   key (a cycle number is 1-based and unique per set); `trainingSetId` is the
 *   set-owned deletion/resume index; `status`/`startedAt` serve the
 *   Feature-014 per-set/current-cycle reads.
 *
 * Sets and cycles are **local user data**; a set's authoritative membership is
 * its stored `puzzleIds` (never a live query), and a cycle snapshots that
 * membership plus its config at start. Every cycle aggregate metric is a
 * **derived** read model over the immutable `puzzleAttempts` rows — never
 * stored on the cycle. Rows are **never synced standalone** (Feature 016
 * tombstones only, consistent with the ownership/deletion rules).
 */
export function applyV10Schema(db: Dexie): void {
  db.version(10).stores({
    trainingSets: '&id, status, createdAt',
    trainingCycles: '&id, &[trainingSetId+cycleNumber], trainingSetId, status, startedAt',
  });
}
