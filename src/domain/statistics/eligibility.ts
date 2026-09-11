/**
 * Feature 014 — eligible-analysis selection and diagnostics (pure).
 *
 * Eligibility is the canonical Feature-008 rule: the latest completed job
 * (by `updatedAt`, any analysis identity) whose persisted per-analysis
 * summary exists. It is independent of the current Library status — a
 * queued/in-progress re-analysis does not remove the previous completed
 * analysis (that is surfaced as a `pendingAnalysis` diagnostic).
 *
 * No React, Dexie, Worker or engine import.
 */

import type { AnalysisJob } from '@/domain/analysis/job';
import { latestCompletedJob } from '@/domain/analysis/status';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import { DETECTION_VERSION } from '@/domain/tactics/types';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import type { StatisticsAnalysisSummary, StatisticsDiagnostics, StatisticsGameRow } from './types';

/** An eligible analysis: the latest completed job and its persisted summary. */
export interface EligibleAnalysis {
  readonly analysisId: string;
  readonly job: AnalysisJob;
  readonly summary: StatisticsAnalysisSummary;
}

/** Group jobs by owning game id (deterministic input order preserved). */
export function groupJobsByGame(jobs: readonly AnalysisJob[]): Map<string, AnalysisJob[]> {
  const byGame = new Map<string, AnalysisJob[]>();
  for (const job of jobs) {
    const list = byGame.get(job.gameId);
    if (list) {
      list.push(job);
    } else {
      byGame.set(job.gameId, [job]);
    }
  }
  return byGame;
}

/** Index summaries by their analysis identity. */
export function groupSummariesByAnalysisId(
  summaries: readonly StatisticsAnalysisSummary[],
): Map<string, StatisticsAnalysisSummary> {
  const byId = new Map<string, StatisticsAnalysisSummary>();
  for (const summary of summaries) {
    byId.set(summary.analysisId, summary);
  }
  return byId;
}

/**
 * True when an analysis carries a detection pass completed at the current
 * `DETECTION_VERSION` (`domain/tactics.md` freshness gate). An older
 * completed pass is not current.
 */
export function detectionIsCurrent(summary: StatisticsAnalysisSummary): boolean {
  return summary.detectionState === 'completed' && summary.detectionVersion === DETECTION_VERSION;
}

/**
 * The eligible analysis of a game: `latestCompletedJob(jobs of game)` when a
 * summary exists for that `analysisId`, else `undefined`. `jobs` may be the
 * full job list or already scoped to the game.
 */
export function eligibleAnalysisOf(
  gameId: string,
  jobs: readonly AnalysisJob[],
  summaries: ReadonlyMap<string, StatisticsAnalysisSummary>,
): EligibleAnalysis | undefined {
  const job = latestCompletedJob(jobs.filter((candidate) => candidate.gameId === gameId));
  if (!job) {
    return undefined;
  }
  const summary = summaries.get(job.id);
  if (!summary) {
    return undefined;
  }
  return { analysisId: job.id, job, summary };
}

/** Inputs for the diagnostics scan. */
export interface StatisticsDiagnosticsInput {
  readonly games: readonly StatisticsGameRow[];
  readonly jobsByGame: ReadonlyMap<string, readonly AnalysisJob[]>;
  readonly summaries: readonly StatisticsAnalysisSummary[];
  /** Optional attempt rows for the orphaned-attempt diagnostic. */
  readonly attempts?: readonly PuzzleAttemptRow[];
  /** Puzzle ids known to exist; attempts outside this set are orphaned. */
  readonly knownPuzzleIds?: ReadonlySet<string>;
}

/**
 * Diagnostics counters over the loaded snapshot. Never throws; missing
 * summary, pending re-analysis, undated games, orphaned summaries/attempts and
 * unrecognized time controls are counted, never fabricated.
 */
export function buildStatisticsDiagnostics(
  input: StatisticsDiagnosticsInput,
): StatisticsDiagnostics {
  const gameIds = new Set(input.games.map((game) => game.id));
  const summaryIds = new Set(input.summaries.map((summary) => summary.analysisId));
  const knownTimeControls = new Set<string>(TIME_CONTROL_CATEGORIES);

  let missingSummary = 0;
  let pendingAnalysis = 0;
  let undated = 0;
  let unrecognizedTimeControls = 0;

  for (const game of input.games) {
    if (game.playedAt === null) {
      undated += 1;
    }
    if (!knownTimeControls.has(game.normalizedTimeControl)) {
      unrecognizedTimeControls += 1;
    }
    const jobs = input.jobsByGame.get(game.id) ?? [];
    if (jobs.some((job) => job.state === 'queued' || job.state === 'inProgress')) {
      pendingAnalysis += 1;
    }
    const latest = latestCompletedJob(jobs);
    if (latest && !summaryIds.has(latest.id)) {
      missingSummary += 1;
    }
  }

  let orphanedSummaries = 0;
  for (const summary of input.summaries) {
    if (!gameIds.has(summary.gameId)) {
      orphanedSummaries += 1;
    }
  }

  let orphanedAttempts = 0;
  if (input.attempts && input.knownPuzzleIds) {
    for (const attempt of input.attempts) {
      if (!input.knownPuzzleIds.has(attempt.puzzleId)) {
        orphanedAttempts += 1;
      }
    }
  }

  return {
    missingSummary,
    pendingAnalysis,
    undated,
    orphanedSummaries,
    orphanedAttempts,
    unrecognizedTimeControls,
  };
}
