/**
 * Feature 014 — per-game history read model (pure).
 *
 * One deterministic `GameHistoryEntry` per game carrying its eligibility,
 * analysis status, detection status and the persisted per-game values the
 * aggregates trace back to. Values are read from the eligible analysis's
 * summary; they are never recomputed here.
 *
 * No React, Dexie, Worker or engine import.
 */

import type { AnalysisJob } from '@/domain/analysis/job';
import { analysisStatusOf } from '@/domain/analysis/status';
import { outcomeOf } from '@/domain/chess/game';
import { detectionIsCurrent, eligibleAnalysisOf } from './eligibility';
import type { GameHistoryEntry, StatisticsAnalysisSummary, StatisticsGameRow } from './types';

/**
 * Build one history entry per game, preserving the given game order.
 * `jobsByGame` is the output of `groupJobsByGame`; `summariesByAnalysisId`
 * is the output of `groupSummariesByAnalysisId`.
 */
export function buildGameHistoryEntries(
  games: readonly StatisticsGameRow[],
  jobsByGame: ReadonlyMap<string, readonly AnalysisJob[]>,
  summariesByAnalysisId: ReadonlyMap<string, StatisticsAnalysisSummary>,
): GameHistoryEntry[] {
  return games.map((game) => {
    const jobs = jobsByGame.get(game.id) ?? [];
    const eligible = eligibleAnalysisOf(game.id, jobs, summariesByAnalysisId);
    const summary = eligible?.summary;
    const missedTactics = summary && detectionIsCurrent(summary) ? summary.missedTacticCount : null;
    return {
      gameId: game.id,
      playedAt: game.playedAt,
      source: game.source,
      normalizedTimeControl: game.normalizedTimeControl,
      userColor: game.userColor,
      outcome: outcomeOf(game.result),
      userRating: game.userRating,
      analysisId: eligible?.analysisId ?? null,
      analysisStatus: analysisStatusOf(jobs),
      accuracy: summary?.accuracy ?? null,
      accuracyMoves: summary?.accuracyMoves ?? 0,
      classificationCounts: summary?.classificationCounts ?? null,
      missedTactics,
    };
  });
}
