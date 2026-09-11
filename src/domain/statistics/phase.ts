/**
 * Feature 014 — game-phase aggregates (pure).
 *
 * Groups the user's persisted `MoveAnalysis` records by their stored
 * `gamePhase` (never re-derived) and counts each negative classification plus
 * missed tactics. Detection-restricted metrics only count moves whose
 * analysis carries a current completed detection pass. Per-phase normalized
 * rates use the user-move denominator for the phase, so phases with different
 * move exposure are never compared by raw count.
 *
 * No React, Dexie, Worker or engine import.
 */

import type { Color } from 'chessops/types';
import { GAME_PHASES } from '@/domain/chess/analysis';
import type { GamePhase, MoveAnalysis } from '@/domain/chess/analysis';
import { aggregateOf, notDetectedAggregate, rate } from './aggregate';
import type { PhaseMetricCounts, PhaseMetrics } from './types';

/** Raw per-phase counters before aggregate/state construction. */
export interface PhaseSummary {
  readonly phase: GamePhase;
  readonly userMovesInPhase: number;
  readonly detectedUserMovesInPhase: number;
  readonly inaccuracies: number;
  readonly mistakes: number;
  readonly blunders: number;
  readonly missedTactics: number;
}

/**
 * Per-phase raw counters plus the analyzed/detected game denominators shared
 * by every phase's count samples.
 */
export interface PhaseSummarySet {
  /** Distinct games with at least one user move in a canonical phase. */
  readonly analyzedGames: number;
  /** Distinct games with a current completed detection pass and a user move. */
  readonly detectedGames: number;
  readonly phases: readonly PhaseSummary[];
}

const PHASE_SET: ReadonlySet<string> = new Set<string>(GAME_PHASES);

interface MutablePhaseSummary {
  phase: GamePhase;
  userMovesInPhase: number;
  detectedUserMovesInPhase: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  missedTactics: number;
}

/**
 * Group the user's `MoveAnalysis` records by `record.gamePhase`.
 *
 * Records for the opponent, records with a missing/unknown phase, and records
 * whose classification is positive (`best`/`good`) never fabricate a phase or
 * a count. `currentDetectionAnalysisIds` restricts missed-tactic and
 * detection-denominator counting to analyses with a current completed pass.
 */
export function summarizeByPhase(
  records: readonly MoveAnalysis[],
  userColor: Color,
  currentDetectionAnalysisIds: ReadonlySet<string>,
): PhaseSummarySet {
  const accumulators = new Map<GamePhase, MutablePhaseSummary>();
  for (const phase of GAME_PHASES) {
    accumulators.set(phase, {
      phase,
      userMovesInPhase: 0,
      detectedUserMovesInPhase: 0,
      inaccuracies: 0,
      mistakes: 0,
      blunders: 0,
      missedTactics: 0,
    });
  }

  const analyzedGameIds = new Set<string>();
  const detectedGameIds = new Set<string>();

  for (const record of records) {
    if (record.side !== userColor) {
      continue;
    }
    const phase = record.gamePhase as GamePhase | null | undefined;
    if (phase === null || phase === undefined || !PHASE_SET.has(phase)) {
      continue;
    }
    const accumulator = accumulators.get(phase);
    if (!accumulator) {
      continue;
    }
    accumulator.userMovesInPhase += 1;
    analyzedGameIds.add(record.gameId);
    if (record.classification === 'inaccuracy') {
      accumulator.inaccuracies += 1;
    } else if (record.classification === 'mistake') {
      accumulator.mistakes += 1;
    } else if (record.classification === 'blunder') {
      accumulator.blunders += 1;
    }
    if (currentDetectionAnalysisIds.has(record.analysisId)) {
      accumulator.detectedUserMovesInPhase += 1;
      detectedGameIds.add(record.gameId);
      if (record.missedTactic) {
        accumulator.missedTactics += 1;
      }
    }
  }

  return {
    analyzedGames: analyzedGameIds.size,
    detectedGames: detectedGameIds.size,
    phases: GAME_PHASES.map((phase) => accumulators.get(phase)!),
  };
}

/**
 * Build the canonical per-phase aggregates from a summary set.
 *
 * Count samples use the `analyzed` game denominator (the `detected` game
 * denominator for missed tactics); normalized `errorsPer100Moves` samples use
 * the per-phase user-move denominator (the detected user-move denominator for
 * missed tactics). `notDetected` is returned for missed-tactic metrics when
 * no analysis has a current completed detection pass.
 */
export function phaseMetricsFor(summary: PhaseSummarySet): readonly PhaseMetrics[] {
  const { analyzedGames, detectedGames } = summary;
  return summary.phases.map((phase) => {
    const counts: PhaseMetricCounts = {
      inaccuracies: aggregateOf(phase.inaccuracies, analyzedGames, 'games'),
      mistakes: aggregateOf(phase.mistakes, analyzedGames, 'games'),
      blunders: aggregateOf(phase.blunders, analyzedGames, 'games'),
      missedTactics:
        detectedGames === 0
          ? notDetectedAggregate('games')
          : aggregateOf(phase.missedTactics, detectedGames, 'games'),
    };
    const errorsPer100Moves: PhaseMetricCounts = {
      inaccuracies: rate(phase.inaccuracies * 100, phase.userMovesInPhase, 'moves'),
      mistakes: rate(phase.mistakes * 100, phase.userMovesInPhase, 'moves'),
      blunders: rate(phase.blunders * 100, phase.userMovesInPhase, 'moves'),
      missedTactics:
        detectedGames === 0
          ? notDetectedAggregate('moves')
          : rate(phase.missedTactics * 100, phase.detectedUserMovesInPhase, 'moves'),
    };
    return {
      phase: phase.phase,
      userMovesInPhase: phase.userMovesInPhase,
      detectedUserMovesInPhase: phase.detectedUserMovesInPhase,
      counts,
      errorsPer100Moves,
    };
  });
}
