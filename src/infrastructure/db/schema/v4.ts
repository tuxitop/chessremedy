import type Dexie from 'dexie';

/**
 * Schema v4 — adds the game-analysis tables (Feature 008, Game Analysis).
 *
 * Purely additive over v3 (`settings`, `games`, `importJobs`):
 *
 * - `analysisJobs` — one persistent row per (game, analysis identity); the
 *   Feature-008 queue (`queued | inProgress | completed | cancelled | failed`)
 *   plus the analysis metadata (engine/profile/version/timestamps).
 * - `analyses` — the authoritative per-ply `MoveAnalysis` records, keyed by
 *   `[analysisId, ply]` and queryable by game / (game, analysis identity).
 * - `positionAnalysisCache` — the independent FEN-keyed engine cache
 *   (ADR-018); scoped by the ADR-018 (profile, engine) tuple in the key and
 *   **never** purged when a game is deleted.
 */
export function applyV4Schema(db: Dexie): void {
  db.version(4).stores({
    analysisJobs: '&id, gameId, state, updatedAt',
    analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
    positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
  });
}
