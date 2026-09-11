/**
 * Library analysis-result query resolution (Feature 010, Game Library
 * milestone).
 *
 * Resolves the `analysis` / `hasBlunders` / `hasMissedTactics` filter
 * dimensions from persisted analysis jobs + per-analysis summaries into a
 * game-id restriction for the pushed-down games query — never by scanning
 * `MoveAnalysis` rows (features/010-tactical-detection.md "Game Library
 * Integration", specs/domain/game-library.md §2, ARCHITECTURE.md §7). Also
 * derives the per-row insights group (row strip values + analysis facts)
 * that the hook overlays on `LibraryGameRow`s before the in-memory filter
 * pass.
 *
 * The statuses use the canonical Feature-008 derivation
 * (`analysisLibraryStatus` over a game's jobs); blunder/missed-tactic
 * outcomes read the summary of the game's latest completed analysis.
 */

import {
  analysisLibraryStatus,
  latestCompletedJob,
  type AnalysisJob,
  type GameAnalysisStatus,
} from '@/domain/analysis';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { GameId } from '@/domain/chess/game';
import type { GameLibraryFilters } from '@/domain/gameLibrary/filters';
import { matchesAnalysisResultFilters } from '@/domain/gameLibrary/predicates';
import type { GameRowInsights } from '@/domain/gameLibrary/rowView';
import type { AnalysisSummaryRow } from './summaries-repository';

/** Per-game analysis facts: status + the strip/summary of the latest run. */
export interface ResolvedGameAnalysis {
  /** Feature-008 library status over the game's persisted jobs. */
  readonly status: GameAnalysisStatus;
  /**
   * Summary of the latest completed analysis, exposed only when the status
   * is `completed`/`outdated` (a queued/in-progress re-analysis hides the
   * strip until its run completes); `null` otherwise or when the run has no
   * persisted summary yet (lazy backfill pending).
   */
  readonly summary: AnalysisSummaryRow | null;
}

export function groupJobsByGame(
  jobs: readonly AnalysisJob[],
): ReadonlyMap<GameId, readonly AnalysisJob[]> {
  const byGame = new Map<GameId, AnalysisJob[]>();
  for (const job of jobs) {
    const list = byGame.get(job.gameId) ?? [];
    list.push(job);
    byGame.set(job.gameId, list);
  }
  return byGame;
}

export function groupSummariesByGame(
  summaries: readonly AnalysisSummaryRow[],
): ReadonlyMap<GameId, readonly AnalysisSummaryRow[]> {
  const byGame = new Map<GameId, AnalysisSummaryRow[]>();
  for (const summary of summaries) {
    const list = byGame.get(summary.gameId) ?? [];
    list.push(summary);
    byGame.set(summary.gameId, list);
  }
  return byGame;
}

/**
 * The analysis facts of one game from its jobs and summaries: the library
 * status (all jobs) and — only for a completed/outdated run — the summary
 * of its latest completed job.
 */
export function resolveGameAnalysis(
  jobs: readonly AnalysisJob[],
  summaries: readonly AnalysisSummaryRow[],
): ResolvedGameAnalysis {
  const status = analysisLibraryStatus(jobs);
  const latest = latestCompletedJob(jobs);
  const latestSummary =
    latest === undefined ? undefined : summaries.find((s) => s.analysisId === latest.id);
  const showStrip = status === 'completed' || status === 'outdated';
  return { status, summary: showStrip && latestSummary ? latestSummary : null };
}

/**
 * The read-only insights overlay for a row from its game's jobs + summaries:
 * the analysis status always; accuracy/counts only when a completed run's
 * summary exists; missed tactics follow absent-vs-zero (`null` until the
 * detection pass completed, `0` a real zero). Feature-011 puzzle data follows
 * the same discipline: `puzzleState`/`puzzleProgress` and
 * `puzzleGeneratorVersion` are carried whenever a summary exists (the version
 * lets the row offer the engine-free Regenerate action on a completed pass
 * from an older generator), while `puzzleCount` (the live `puzzles`-row
 * count of the game, from the optional per-game counts map) is exposed only
 * when the generation pass `completed` **and** the detection result is
 * `completed` at the current pipeline version (plan-015 freshness gate / plan
 * R-6: a stale detection suppresses the count with the Feature-010 note). The
 * Feature-014 `masteredPuzzleCount` follows the same absent-vs-zero discipline:
 * it is exposed only when the caller loaded a real number for the game (a real
 * `0` is kept; a missing key — an `empty` mastery read — exposes nothing), and
 * it is independent of analysis freshness (a puzzle's attempts are immutable
 * provenance). The function stays pure — counts are a parameter, never a
 * repository import.
 */
export function analysisInsightsForGame(
  jobs: readonly AnalysisJob[],
  summaries: readonly AnalysisSummaryRow[],
  puzzleCountsByGame?: Readonly<Record<GameId, number>>,
  masteredCountsByGame?: Readonly<Record<GameId, number>>,
): GameRowInsights {
  const { status, summary } = resolveGameAnalysis(jobs, summaries);
  // The game id is known even without a persisted summary (the row always has
  // jobs/summaries); mastery is analysis-independent, so a present count is
  // exposed in both branches. Absent ≠ zero: a missing key exposes no value.
  const gameId = summary?.gameId ?? jobs[0]?.gameId ?? summaries[0]?.gameId;
  const masteredPuzzleCount = gameId !== undefined ? masteredCountsByGame?.[gameId] : undefined;
  if (summary === null) {
    return {
      analysisStatus: status,
      ...(masteredPuzzleCount !== undefined ? { masteredPuzzleCount } : {}),
    };
  }
  // A detection pass is only "completed" when it was produced by the current
  // pipeline version (plan 015 freshness gate): an older completed result is
  // outdated — its count is suppressed and the row offers a refresh scan.
  const detectionCompleted =
    summary.detectionState === 'completed' && summary.detectionVersion === DETECTION_VERSION;
  const puzzleState = summary.puzzleState ?? 'absent';
  const puzzleProgress = summary.puzzleProgress ?? null;
  // Absent ≠ zero: a puzzle count is only ever the live row count of a
  // `completed` generation pass over a current completed detection (R-6). The
  // per-game counts map always carries a key for every listed row; a missing
  // key (a row whose count was not loaded) exposes no count either.
  const puzzleCount =
    detectionCompleted && puzzleState === 'completed'
      ? puzzleCountsByGame?.[summary.gameId]
      : undefined;
  return {
    analysisStatus: status,
    accuracy: summary.accuracy,
    classificationCounts: summary.classificationCounts,
    detectionState: summary.detectionState,
    detectionVersion: summary.detectionVersion,
    hasCompletedDetection: detectionCompleted,
    missedTactics: detectionCompleted ? summary.missedTacticCount : null,
    scanProgress: summary.scanProgress ?? null,
    puzzleState,
    puzzleGeneratorVersion: summary.puzzleGeneratorVersion ?? null,
    puzzleProgress,
    ...(puzzleCount !== undefined ? { puzzleCount } : {}),
    ...(masteredPuzzleCount !== undefined ? { masteredPuzzleCount } : {}),
  };
}

/**
 * The game ids satisfying the active analysis-result dimensions, over the
 * given game universe (`gameIds`), jobs and summaries. Applies the same
 * semantics as `matchesAnalysisResultFilters`. Returns `null` when all three
 * dimensions are `'all'` (no restriction).
 */
export function resolveAnalysisResultFilter(
  filters: GameLibraryFilters,
  gameIds: readonly GameId[],
  jobs: readonly AnalysisJob[],
  summaries: readonly AnalysisSummaryRow[],
): Set<GameId> | null {
  if (
    filters.analysis === 'all' &&
    filters.hasBlunders === 'all' &&
    filters.hasMissedTactics === 'all'
  ) {
    return null;
  }
  const jobsByGame = groupJobsByGame(jobs);
  const summariesByGame = groupSummariesByGame(summaries);
  const matching = new Set<GameId>();
  for (const gameId of gameIds) {
    const insights = analysisInsightsForGame(
      jobsByGame.get(gameId) ?? [],
      summariesByGame.get(gameId) ?? [],
    );
    if (matchesAnalysisResultFilters(insights, filters)) {
      matching.add(gameId);
    }
  }
  return matching;
}
