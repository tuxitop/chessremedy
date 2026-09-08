import type Dexie from 'dexie';

/**
 * Schema v8 — Feature 011 (tactical puzzle generation) game-scoped derived
 * data.
 *
 * Purely additive over v7 (`settings`, `games`, `importJobs`, `analysisJobs`,
 * `analyses`, `positionAnalysisCache`, `analysisSummaries`,
 * `puzzleCandidates`). The new table starts empty, so no `upgrade` backfill is
 * needed:
 *
 * - `puzzles` — one immutable puzzle row per game position, assembled from a
 *   Feature-010 verified candidate. Natural key `[sourceGameId + sourcePly]`:
 *   one durable puzzle per (game, ply), so re-analysis and idempotent re-runs
 *   never overwrite an existing row. `sourceGameId` is the game-scoping index
 *   (per-game list/count and the deletion cascade); `analysisId` carries
 *   provenance for debugging and later transitive cleanup.
 *
 * Rows are add-only once written: the repository (`puzzles-repository.ts`)
 * never exposes an update/overwrite for the row body (spec
 * "Deduplication & re-analysis", ARCHITECTURE.md §7).
 */
export function applyV8Schema(db: Dexie): void {
  db.version(8).stores({
    puzzles: '&[sourceGameId+sourcePly], sourceGameId, analysisId',
  });
}
