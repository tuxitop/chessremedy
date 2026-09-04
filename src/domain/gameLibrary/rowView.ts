/**
 * Game Library row extensibility (Feature 007).
 *
 * Future features (008 bulk/review + analysis status, 009 classification
 * counts/accuracy, 010 missed tactics, 011 puzzles-from-game, 012/013/014
 * mastered counts) plug into per-row **insights** and per-row **actions**
 * through capability keys. V1 registers only `delete`; insights are absent
 * until an owner feature supplies values. The Library renders present
 * values read-only and never computes them.
 */

export type GameActionCapability = 'liveAnalysis' | 'review' | 'puzzles' | 'delete';

export type GameInsightCapability =
  | 'accuracy'
  | 'analysisStatus'
  | 'classificationCounts'
  | 'missedTactics'
  | 'puzzleCount'
  | 'masteredPuzzleCount';

export interface GameRowInsights {
  readonly accuracy?: number;
  readonly analysisStatus?: 'unanalyzed' | 'inProgress' | 'completed' | 'failed';
  readonly classificationCounts?: Readonly<Record<string, number>>;
  readonly missedTactics?: number;
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
