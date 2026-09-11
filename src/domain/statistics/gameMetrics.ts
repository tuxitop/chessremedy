/**
 * Feature 014 — game-analysis aggregates (pure).
 *
 * Classification counts/rates/medians/shares, missed-tactic aggregates and
 * the ADR-024 move-weighted accuracy, all computed from the per-game
 * `GameHistoryEntry` read model. No classification, accuracy or detection
 * math is re-implemented: per-game values are read from the persisted
 * summary and only aggregated here.
 *
 * No React, Dexie, Worker or engine import.
 */

import {
  accuracyAggregate,
  aggregateOf,
  median,
  notDetectedAggregate,
  rate,
  share,
} from './aggregate';
import type {
  ClassificationMetrics,
  GameHistoryEntry,
  GameMetrics,
  GamesCounts,
  MissedTacticMetrics,
} from './types';

/** Optional authoritative diagnostics counters (from `eligibility.ts`). */
export interface GameMetricDiagnostics {
  readonly missingSummary?: number;
  readonly pendingAnalysis?: number;
  readonly undated?: number;
}

function sumBy<T>(items: readonly T[], valueOf: (item: T) => number): number {
  let total = 0;
  for (const item of items) {
    total += valueOf(item);
  }
  return total;
}

function derivedMissingSummary(entries: readonly GameHistoryEntry[]): number {
  return entries.filter(
    (entry) =>
      entry.analysisId === null &&
      (entry.analysisStatus === 'completed' || entry.analysisStatus === 'outdated'),
  ).length;
}

function derivedPendingAnalysis(entries: readonly GameHistoryEntry[]): number {
  return entries.filter(
    (entry) => entry.analysisStatus === 'queued' || entry.analysisStatus === 'inProgress',
  ).length;
}

/**
 * Aggregate a set of history entries. The set is expected to be one query
 * dimension partition; the function itself is dimension-agnostic.
 *
 * `diagnostics` may supply the authoritative `missingSummary` /
 * `pendingAnalysis` / `undated` counters (which cannot always be derived from
 * an entry alone); when omitted they are derived from the entries.
 */
export function gameMetricsFor(
  entries: readonly GameHistoryEntry[],
  diagnostics?: GameMetricDiagnostics,
): GameMetrics {
  const analyzed = entries.filter((entry) => entry.analysisId !== null);
  const detected = analyzed.filter((entry) => entry.missedTactics !== null);
  const analyzedCount = analyzed.length;
  const detectedCount = detected.length;

  const games: GamesCounts = {
    total: entries.length,
    analyzed: analyzedCount,
    detected: detectedCount,
    missingSummary: diagnostics?.missingSummary ?? derivedMissingSummary(entries),
    pendingAnalysis: diagnostics?.pendingAnalysis ?? derivedPendingAnalysis(entries),
    undated: diagnostics?.undated ?? entries.filter((entry) => entry.playedAt === null).length,
  };

  const blunderOf = (entry: GameHistoryEntry): number => entry.classificationCounts?.blunder ?? 0;
  const mistakeOf = (entry: GameHistoryEntry): number => entry.classificationCounts?.mistake ?? 0;
  const inaccuracyOf = (entry: GameHistoryEntry): number =>
    entry.classificationCounts?.inaccuracy ?? 0;

  const inaccuracies = sumBy(analyzed, inaccuracyOf);
  const mistakes = sumBy(analyzed, mistakeOf);
  const blunders = sumBy(analyzed, blunderOf);

  const classification: ClassificationMetrics = {
    inaccuracies: aggregateOf(inaccuracies, analyzedCount, 'games'),
    mistakes: aggregateOf(mistakes, analyzedCount, 'games'),
    blunders: aggregateOf(blunders, analyzedCount, 'games'),
    inaccuraciesPerGame: rate(inaccuracies, analyzedCount, 'games'),
    mistakesPerGame: rate(mistakes, analyzedCount, 'games'),
    blundersPerGame: rate(blunders, analyzedCount, 'games'),
    medianBlundersPerGame: median(analyzed.map(blunderOf), 'games'),
    medianMistakesPerGame: median(analyzed.map(mistakeOf), 'games'),
    gamesWithBlunderShare: share(
      analyzed.filter((entry) => blunderOf(entry) > 0).length,
      analyzedCount,
      'games',
    ),
    gamesWithMistakeShare: share(
      analyzed.filter((entry) => mistakeOf(entry) > 0).length,
      analyzedCount,
      'games',
    ),
  };

  const missedTotal = sumBy(detected, (entry) => entry.missedTactics ?? 0);
  const missedTactics: MissedTacticMetrics =
    detectedCount === 0
      ? {
          missedTactics: notDetectedAggregate('games'),
          missedTacticsPerGame: notDetectedAggregate('games'),
          gamesWithMissedTacticShare: notDetectedAggregate('games'),
        }
      : {
          missedTactics: aggregateOf(missedTotal, detectedCount, 'games'),
          missedTacticsPerGame: rate(missedTotal, detectedCount, 'games'),
          gamesWithMissedTacticShare: share(
            detected.filter((entry) => (entry.missedTactics ?? 0) > 0).length,
            detectedCount,
            'games',
          ),
        };

  const accuracy = accuracyAggregate(
    analyzed.map((entry) => ({
      accuracy: entry.accuracy,
      weightMoves: entry.accuracyMoves,
    })),
  );

  return { games, classification, missedTactics, accuracy };
}
