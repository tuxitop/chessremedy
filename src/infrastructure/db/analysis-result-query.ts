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
 * detection pass completed, `0` a real zero).
 */
export function analysisInsightsForGame(
  jobs: readonly AnalysisJob[],
  summaries: readonly AnalysisSummaryRow[],
): GameRowInsights {
  const { status, summary } = resolveGameAnalysis(jobs, summaries);
  if (summary === null) {
    return { analysisStatus: status };
  }
  const detectionCompleted = summary.detectionState === 'completed';
  return {
    analysisStatus: status,
    accuracy: summary.accuracy,
    classificationCounts: summary.classificationCounts,
    detectionState: summary.detectionState,
    hasCompletedDetection: detectionCompleted,
    missedTactics: detectionCompleted ? summary.missedTacticCount : null,
    scanProgress: summary.scanProgress ?? null,
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
