/**
 * Feature 015 — dashboard labels (pure, no React).
 *
 * Canonical text for partitions, phases, error metrics and training metrics.
 * Platform and objective labels reuse the canonical Feature-003/Feature-011
 * maps; time-control category labels follow ADR-013 order and the Game
 * Library's house style.
 */

import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import { GAME_PHASES } from '@/domain/chess/analysis';
import type { GamePhase } from '@/domain/chess/analysis';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import { BLUNDER_OBJECTIVE_LABEL, OBJECTIVE_LABELS } from '@/domain/puzzle/objectiveLabel';
import type {
  PlatformDimension,
  TimeControlDimension,
  WeaknessCategory,
} from '@/domain/statistics';

/** Platform labels including the `all` dimension (canonical order preserved). */
export const PLATFORM_LABELS: Readonly<Record<PlatformDimension, string>> = {
  all: 'All platforms',
  ...GAME_SOURCE_LABELS,
};

/** Time-control labels in ADR-013 order, plus the `all` dimension. */
export const TIME_CONTROL_LABELS: Readonly<Record<TimeControlCategory, string>> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Correspondence',
  unknown: 'Other',
};

/** Time-control labels including the `all` dimension. */
export const TIME_CONTROL_DIMENSION_LABELS: Readonly<Record<TimeControlDimension, string>> = {
  all: 'All time controls',
  ...TIME_CONTROL_LABELS,
};

/** Selector label for the explicit all-partitions choice. */
export const ALL_PARTITIONS_LABEL = 'All partitions';

/** Partition-selector labels keyed by partition value. */
export const PARTITION_LABELS: Readonly<Record<string, string>> = {
  all: ALL_PARTITIONS_LABEL,
};

/** Human label of one concrete `(platform, timeControl)` partition. */
export function partitionLabel(
  platform: PlatformDimension,
  timeControl: TimeControlDimension,
): string {
  return `${PLATFORM_LABELS[platform]} · ${TIME_CONTROL_DIMENSION_LABELS[timeControl]}`;
}

/** Canonical game-phase labels. */
export const PHASE_LABELS: Readonly<Record<GamePhase, string>> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

/** The canonical phase order (opening → middlegame → endgame). */
export const PHASE_ORDER: readonly GamePhase[] = [...GAME_PHASES];

export function phaseLabel(phase: GamePhase): string {
  return PHASE_LABELS[phase];
}

/** The four error classes and their per-game trend variants. */
export type ErrorMetric =
  | 'inaccuracies'
  | 'mistakes'
  | 'blunders'
  | 'missedTactics'
  | 'inaccuraciesPerGame'
  | 'mistakesPerGame'
  | 'blundersPerGame'
  | 'missedTacticsPerGame';

/** Labels for the error trend metrics (counts and per-game rates). */
export const ERROR_METRIC_LABELS: Readonly<Record<ErrorMetric, string>> = {
  inaccuracies: 'Inaccuracies',
  mistakes: 'Mistakes',
  blunders: 'Blunders',
  missedTactics: 'Missed tactics',
  inaccuraciesPerGame: 'Inaccuracies per game',
  mistakesPerGame: 'Mistakes per game',
  blundersPerGame: 'Blunders per game',
  missedTacticsPerGame: 'Missed tactics per game',
};

export function errorMetricLabel(metric: ErrorMetric): string {
  return ERROR_METRIC_LABELS[metric];
}

/** The training metrics surfaced per cycle. */
export type TrainingMetric =
  | 'puzzlesCompleted'
  | 'puzzlesSkipped'
  | 'firstTryAccuracy'
  | 'solveRate'
  | 'solvingTimeTotal'
  | 'solvingTimeAverage'
  | 'solvingTimeMedian'
  | 'hintsUsed'
  | 'puzzlesRequiringHint'
  | 'retries'
  | 'puzzlesRequiringRetry'
  | 'completionRate';

/** Labels for the per-cycle training metrics. */
export const TRAINING_METRIC_LABELS: Readonly<Record<TrainingMetric, string>> = {
  puzzlesCompleted: 'Puzzles completed',
  puzzlesSkipped: 'Skipped',
  firstTryAccuracy: 'First-try accuracy',
  solveRate: 'Solve rate',
  solvingTimeTotal: 'Total solving time',
  solvingTimeAverage: 'Average solving time',
  solvingTimeMedian: 'Median solving time',
  hintsUsed: 'Hints used',
  puzzlesRequiringHint: 'Puzzles needing a hint',
  retries: 'Retries',
  puzzlesRequiringRetry: 'Puzzles needing a retry',
  completionRate: 'Completion',
};

export function trainingMetricLabel(metric: TrainingMetric): string {
  return TRAINING_METRIC_LABELS[metric];
}

/**
 * Human label of a weakest-category key: the canonical Feature-011 objective
 * label, or the blunder "correct move" label for `blunder` (no recomputation).
 */
export function weakestCategoryLabel(category: WeaknessCategory): string {
  return category === 'blunder' ? BLUNDER_OBJECTIVE_LABEL : OBJECTIVE_LABELS[category];
}

/** The canonical time-control category order (ADR-013). */
export const TIME_CONTROL_ORDER: readonly TimeControlCategory[] = [...TIME_CONTROL_CATEGORIES];
