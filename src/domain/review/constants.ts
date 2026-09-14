/**
 * Feature 020 — review-scheduling constants (pure).
 *
 * The version stamps that gate lazy rebuilds, the daily-cap defaults/safety
 * maxima, the grade-mapping latency threshold and the review session's cycle
 * configuration. `REVIEW_SET_ID` is re-exported from the training domain's
 * reserved sentinels so there is a single definition.
 */

import { CYCLE_CONFIG_VERSION, type CycleConfig } from '@/domain/training/cycleTypes';

export { REVIEW_SET_ID } from '@/domain/training/autoSet';

/**
 * Version of the projection/grade-mapping semantics. Bump when the fold, the
 * persisted row shape or the grade mapping changes; a stored row with a
 * different value is stale and rebuilt lazily (O-7: a grade-mapping bump also
 * bumps this).
 */
export const SCHEDULE_VERSION = 1;

/**
 * Version of the deterministic grade mapping (`grade.ts`). Distinct from
 * `SCHEDULE_VERSION`; a change here also bumps `SCHEDULE_VERSION` so the
 * projection rebuilds.
 */
export const GRADE_MAPPING_VERSION = 1;

/**
 * Version of the scheduler parameter set (FSRS defaults with fuzz disabled).
 * A change to the parameters is a new version and gates a lazy rebuild.
 */
export const SCHEDULER_PARAMS_VERSION = 1;

/** A clean solve at or below this latency (millis) is graded `easy`. */
export const EASY_SOLVE_MS = 10_000;

/** Default daily new-puzzle cap. */
export const DEFAULT_DAILY_NEW_CAP = 20;

/** Default daily review cap. */
export const DEFAULT_DAILY_REVIEW_CAP = 100;

/** Documented safety maximum for the daily new-puzzle cap. */
export const MAX_DAILY_NEW_CAP = 200;

/** Documented safety maximum for the daily review cap. */
export const MAX_DAILY_REVIEW_CAP = 1_000;

/** Default bounded reconcile batch size (per pass). */
export const SCHEDULE_REBUILD_BATCH = 50;

/**
 * The cycle configuration snapshotted onto every review session: one
 * presentation per puzzle (`retryFailed: 'none'`) with skipping allowed. It is
 * a valid `CycleConfig` so the Feature-013 session host's resume path can be
 * reused unchanged.
 */
export const REVIEW_CYCLE_CONFIG: CycleConfig = {
  ordering: 'manual',
  retryFailed: 'none',
  hints: { enabledLevels: [1, 2, 3, 4], firstHintLevel: 2 },
  allowSkip: true,
  targetAccuracy: null,
  targetSolvingTimeMs: null,
  plannedCycles: null,
  configVersion: CYCLE_CONFIG_VERSION,
};
