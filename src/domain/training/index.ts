/**
 * Feature 012/013 — puzzle-training domain (barrel).
 *
 * The pure, engine/network/IndexedDB-free heart of the solving experience
 * (Feature 012): presentation solving over an immutable Feature-011
 * `PuzzleRow`, hint-level gating/content, outcome derivation, and the immutable
 * `PuzzleAttemptRow` builder. Feature 013 extends the surface with the
 * training-set and cycle vocabulary, membership resolution/ordering, the cycle
 * lifecycle/queue/resume predicates, config validation and the canonical
 * cycle-metric function shared with Feature 014. The deterministic fixtures
 * live in `test-support.ts` (imported directly, mirroring the Feature-011
 * surface).
 */

export type {
  HintLevel,
  PresentationCounters,
  PresentationOutcome,
  PuzzleAttemptRow,
  SessionPuzzleContext,
  SolveHintConfig,
  TrainingResult,
} from './types';
export {
  acceptedMovesOf,
  applyMove,
  beginPresentation,
  playedLine,
  positionAtPly,
  presentationSolved,
  restartPresentation,
} from './solve';
export type {
  PresentationBeginResult,
  PresentationMoveResult,
  PresentationPositionResult,
  PresentationState,
} from './solve';
export { DEFAULT_SOLVE_HINT_CONFIG, hintContent, nextHintLevel, revealNextHint } from './hints';
export type { HintContent, HintContentResult, HintRevealResult } from './hints';
export { buildAttemptRow, deriveResult, presentationOutcomeOf } from './outcome';
export type { BuildAttemptRowInput, OutcomeTrigger } from './outcome';
export {
  CYCLE_CONFIG_VERSION,
  CYCLE_METRICS_VERSION,
  DEFAULT_CYCLE_CONFIG,
  DEFAULT_TARGET_SIZE,
} from './cycleTypes';
export type {
  CycleConfig,
  HintConfig,
  OrderingPolicy,
  PuzzlePoolEntry,
  PuzzlePoolFilters,
  RetryFailed,
  SetSource,
  BlockRecipe,
  TacticalTrainingSetRow,
  TrainingCycleRow,
  TrainingCycleStatus,
  TrainingSetStatus,
} from './cycleTypes';
export { orderPuzzles, resolveSetMembership, setSourceLabel } from './set';
export type { ResolveSetMembershipInput } from './set';
export {
  BLOCK_RECIPE_VERSION,
  BLOCK_SIZE_OPTIONS,
  DEFAULT_BLOCK_SIZE,
  QUICK_TRAIN_SET_ID,
  RECOMMENDED_MIN_BLOCK_SIZE,
  WOODPECKER_PLAN_CYCLES,
  derivePool,
  formWoodpeckerBlock,
} from './autoSet';
export type { DerivePoolInput, FormWoodpeckerBlockInput } from './autoSet';
export {
  MASTERY_REQUIRED_CYCLES,
  MASTERY_VERSION,
  isLegitimateFirstTry,
  masteredPuzzleIds,
  masteryOf,
} from './mastery';
export {
  isCycleComplete,
  isPuzzleTerminal,
  nextCycleNumber,
  reconstructResume,
  resolvePuzzleCycle,
  snapshotCycle,
  solveHintConfigOf,
  validateCycleConfig,
} from './cycle';
export type {
  CycleProgressInput,
  CycleResolution,
  ResumeEntry,
  ResumeQueue,
  SnapshotCycleInput,
  ValidateCycleConfigResult,
} from './cycle';
export {
  compareCycleMetrics,
  computeCycleMetrics,
  cycleTimeGoal,
  isSameLocalCalendarDay,
  spacingNudgeFor,
} from './cycleMetrics';
export { FIRST_CYCLE_FIRST_TRY_BAND } from './cycleMetrics';
export type {
  ComputeCycleMetricsInput,
  CycleComparison,
  CycleMetricDeltas,
  CycleMetricKey,
  CycleMetrics,
  CycleSpacingNudge,
  CycleTimeGoal,
  SolvingTimeMetrics,
} from './cycleMetrics';
