/**
 * Game Library row extensibility (Feature 007).
 *
 * Future features (008 bulk/review + analysis status, 009 classification
 * counts/accuracy, 010 missed tactics, 011 puzzles-from-game, 012/013/014
 * mastered counts) plug into per-row **insights** and per-row **actions**
 * through capability keys. V1 registers only `delete`; insights are absent
 * until an owner feature supplies values. The Library renders present
 * values read-only and never computes them.
 *
 * The analysis-result fields (`analysisStatus`, `accuracy`,
 * `classificationCounts`, `missedTactics`, `hasCompletedDetection`) are
 * supplied by the Feature-010 Game Library milestone over persisted
 * analysis jobs + per-analysis summaries (specs/domain/game-library.md §7):
 * values are user-side, derive from the latest completed analysis, and
 * follow the absent-vs-zero contract (`missedTactics` is `null` until a
 * detection pass completed and `undefined` when no completed analysis
 * exists; `0` is a real zero).
 */

import type { GameAnalysisStatus } from '@/domain/analysis';
import type { ClassificationCounts } from '@/domain/analysis/summary';
import type { SummaryDetectionState } from '@/domain/analysis/summaryDerivation';

export type GameActionCapability = 'liveAnalysis' | 'review' | 'puzzles' | 'delete';

export type GameInsightCapability =
  | 'accuracy'
  | 'analysisStatus'
  | 'classificationCounts'
  | 'missedTactics'
  | 'puzzleCount'
  | 'masteredPuzzleCount';

export interface GameRowInsights {
  /** ADR-024 user per-game accuracy; `null` = no usable user move (em-dash). */
  readonly accuracy?: number | null;
  /** Feature-008 analysis status over the game's persisted jobs. */
  readonly analysisStatus?: GameAnalysisStatus;
  /** User-side ADR-023 counts of the latest completed analysis. */
  readonly classificationCounts?: Readonly<ClassificationCounts>;
  /**
   * Detection-pass state of the latest completed analysis (Feature 010):
   * `'completed'` means `missedTactics` is a real number (zero included);
   * `'absent'` = never scanned, `'queued'`/`'inProgress'` = scanning,
   * `'failed'` = a scan attempt ended. Exposed so a row can say "not scanned"
   * instead of silently showing nothing.
   */
  readonly detectionState?: SummaryDetectionState;
  /** True once a Feature-010 detection pass completed for the analysis. */
  readonly hasCompletedDetection?: boolean;
  /**
   * User missed-tactic count of a completed detection pass (`0` is real);
   * `null` until the pass completed; absent when no completed analysis.
   */
  readonly missedTactics?: number | null;
  readonly puzzleCount?: number;
  readonly masteredPuzzleCount?: number;
}

export interface GameRowAction {
  readonly capability: GameActionCapability;
  readonly label: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

/** Actions a feature may register for a row; V1 ships only `delete`. */
export const ROW_ACTIONS_BY_CAPABILITY: readonly GameActionCapability[] = ['delete'];
