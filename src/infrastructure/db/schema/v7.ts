import type Dexie from 'dexie';

/**
 * Schema v7 — Feature 010 (tactical detection) game-scoped derived data.
 *
 * Purely additive over v6 (`settings`, `games`, `importJobs`, `analysisJobs`,
 * `analyses`, `positionAnalysisCache`). Both new tables start empty, so no
 * `upgrade` backfill is needed:
 *
 * - `analysisSummaries` — one persisted row per analysis identity: the
 *   Feature-009-count/accuracy composition plus the detection-pass state
 *   (the row the Game Library strip and analysis-result filters read). Keyed
 *   by `analysisId`, queryable by game.
 * - `puzzleCandidates` — the two-stage detection output, owned by its source
 *   game (ARCHITECTURE.md §7). Natural key `[analysisId + sourcePly]` so
 *   detection stays scoped to the analysis identity that produced it;
 *   queryable by source game and by analysis identity.
 *
 * `gameId` on summaries and `sourceGameId` on candidates are the game-scoping
 * index of each table (the candidate's game field keeps its domain name).
 */
export function applyV7Schema(db: Dexie): void {
  db.version(7).stores({
    analysisSummaries: '&analysisId, gameId',
    puzzleCandidates: '&[analysisId+sourcePly], sourceGameId, analysisId',
  });
}
