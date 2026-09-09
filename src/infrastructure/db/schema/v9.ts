import type Dexie from 'dexie';

/**
 * Schema v9 — Feature 012 (puzzle training) immutable attempt rows.
 *
 * Purely additive over v8 (`settings`, `games`, `importJobs`, `analysisJobs`,
 * `analyses`, `positionAnalysisCache`, `analysisSummaries`,
 * `puzzleCandidates`, `puzzles`). The new table starts empty, so no `upgrade`
 * backfill is needed:
 *
 * - `puzzleAttempts` — one immutable row per puzzle **presentation** in a
 *   cycle, add-only once written (the repository
 *   `attempts-repository.ts` never exposes an update/overwrite). Primary
 *   natural key `[cycleId + puzzleId + presentationIndex]`: the spec's
 *   one-row-per-presentation key — a re-presentation in the same cycle
 *   carries an incremented `presentationIndex` and is a **new** row, never an
 *   overwrite.
 *
 * Indexes serve the Feature-012/013 reads and the game-deletion cascade:
 * `puzzleId` is the cascade + per-puzzle read index (attempts follow their
 * puzzle through the game's `puzzles` rows — no game column is stored on an
 * attempt, per ARCHITECTURE.md §7); `cycleId` and `[cycleId+puzzleId]` serve
 * per-cycle and per-(cycle,puzzle) listing for Feature-013 lifecycle/metrics;
 * `trainingSetId` is Feature-013's set-owned cleanup seam.
 *
 * Attempt rows are derived per-game data and are **never synced standalone**
 * (Feature 016 tombstones only — sync moves the source game and its derived
 * rows together). Rows stay interpretable after the puzzle generator
 * advances because each attempt copies the puzzle's `puzzleGeneratorVersion`
 * and normalized `origin` at write time (ARCHITECTURE.md §9).
 */
export function applyV9Schema(db: Dexie): void {
  db.version(9).stores({
    puzzleAttempts:
      '&[cycleId+puzzleId+presentationIndex], [cycleId+puzzleId], cycleId, puzzleId, trainingSetId',
  });
}
