/**
 * Per-analysis summary derivation (Feature 010, Game Library milestone).
 *
 * The canonical builder for the game-scoped **per-analysis summary** the Game
 * Library row strip and the analysis-result filters consume
 * (features/010-tactical-detection.md "Game Library Integration" + "Data
 * requirements", specs/domain/game-library.md §7). It composes the canonical
 * Feature-009 domain functions over the latest completed analysis's persisted
 * `MoveAnalysis` — `summarizeAnalysis` for the user-side classification counts
 * and `gameAccuracy` (ADR-024) for per-game accuracy — never a second
 * implementation of that math.
 *
 * The detection holder follows the spec's **absent-vs-zero** contract:
 * `missedTacticCount` is `null` (absent) until a detection pass has completed
 * for the analysis and a real `0` only once a completed pass found nothing.
 * When a pass completes, the count is derived from the records' persisted
 * `missedTactic` annotations (`summarizeAnalysis` `userMissedTactics`), which
 * are the canonical source of the completed-pass count; V1 records always
 * reflect the completed pass (re-analysis yields fresh records).
 *
 * Pure, deterministic and framework-free: no React, Dexie or Worker imports;
 * the input `records` and `options` are never mutated.
 */

import type { Color } from 'chessops/types';
import type { MoveAnalysis } from '@/domain/chess';
import type { DetectionPassState } from '@/domain/tactics';
import { gameAccuracy } from './accuracy';
import type { ClassificationCounts } from './summary';
import { summarizeAnalysis } from './summary';

/** Detection-pass state of an analysis: `'absent'` until Feature 010 schedules a pass. */
export type SummaryDetectionState = DetectionPassState | 'absent';

export interface BuildAnalysisSummaryOptions {
  /**
   * Detection-pass state to record. Defaults to `'absent'` (no pass has been
   * scheduled or run for this analysis). The service passes `'queued'` when an
   * analysis run completes and `'completed'`/`'failed'` when the pass settles.
   */
  readonly detectionState?: SummaryDetectionState;
  /**
   * User missed-tactic count for a completed pass. Optional: when the state is
   * `'completed'` and no number is supplied, the count is derived from the
   * records' persisted `missedTactic` annotations. For any non-`'completed'`
   * state this is ignored and the stored count is `null` — absent is not zero.
   */
  readonly missedTacticCount?: number | null;
  /**
   * Detection version of the completed pass (Feature 010 writes
   * `DETECTION_VERSION`). Only retained for the `'completed'` state; otherwise
   * the stored version is `null`.
   */
  readonly detectionVersion?: number | null;
}

export interface PerAnalysisSummary {
  /**
   * User-side ADR-023 classification counts (one classification per persisted
   * user move).
   */
  readonly classificationCounts: ClassificationCounts;
  /** Total number of the user's moves that carry a persisted analysis. */
  readonly userMoves: number;
  /** Total analyzed plies (user and opponent). */
  readonly totalMoves: number;
  /**
   * ADR-024 per-game accuracy over the user's usable moves, or `null` when no
   * usable user move exists (the strip shows an em-dash, never a zero).
   */
  readonly accuracy: number | null;
  /** Number of user moves included in the accuracy mean (the sample size). */
  readonly accuracyMoves: number;
  /** Detection-pass state for this analysis; `'absent'` until a pass is scheduled. */
  readonly detectionState: SummaryDetectionState;
  /**
   * User missed-tactic count, or `null` until a detection pass has completed
   * for the analysis (absent ≠ zero). A completed pass that found nothing is
   * the value `0`.
   */
  readonly missedTacticCount: number | null;
  /** Detection version of the completed pass; `null` until one completes. */
  readonly detectionVersion: number | null;
}

function detectionHolderFor(
  state: SummaryDetectionState,
  persistedMissedTactics: number,
  explicitCount: number | null | undefined,
  explicitVersion: number | null | undefined,
): { readonly missedTacticCount: number | null; readonly detectionVersion: number | null } {
  if (state !== 'completed') {
    return { missedTacticCount: null, detectionVersion: null };
  }
  return {
    missedTacticCount: typeof explicitCount === 'number' ? explicitCount : persistedMissedTactics,
    detectionVersion: explicitVersion ?? null,
  };
}

/**
 * Build the persisted per-analysis summary for one completed analysis run over
 * its `MoveAnalysis` records (Features 008/009 outputs) and the user's color.
 * `records` are read-only and never mutated.
 */
export function buildAnalysisSummary(
  records: readonly MoveAnalysis[],
  userColor: Color,
  options: BuildAnalysisSummaryOptions = {},
): PerAnalysisSummary {
  const analysis = summarizeAnalysis(records, userColor);
  const accuracy = gameAccuracy(records, userColor);
  const detectionState: SummaryDetectionState = options.detectionState ?? 'absent';
  const holder = detectionHolderFor(
    detectionState,
    analysis.userMissedTactics,
    options.missedTacticCount,
    options.detectionVersion,
  );
  return {
    classificationCounts: analysis.user,
    userMoves: analysis.userMoves,
    totalMoves: analysis.totalMoves,
    accuracy: accuracy.accuracy,
    accuracyMoves: accuracy.moves,
    detectionState,
    missedTacticCount: holder.missedTacticCount,
    detectionVersion: holder.detectionVersion,
  };
}
