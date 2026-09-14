/**
 * Feature 020 — individual review-scheduling domain (barrel).
 *
 * The pure, library-free heart of the review strategy: the `Scheduler` seam,
 * the deterministic grade mapping, the schedule projection/rebuild path, the
 * due-queue builder, derived day usage and the review value types. The
 * `ts-fsrs` adapter lives in `src/infrastructure/review/` and is the only
 * module that imports the library.
 */

export type {
  DayUsage,
  Grade,
  ReviewCaps,
  ReviewOverview,
  ReviewQueueEntry,
  ReviewQueueKind,
  SchedulePhase,
  ScheduleState,
  Scheduler,
} from './types';
export {
  DEFAULT_DAILY_NEW_CAP,
  DEFAULT_DAILY_REVIEW_CAP,
  EASY_SOLVE_MS,
  GRADE_MAPPING_VERSION,
  MAX_DAILY_NEW_CAP,
  MAX_DAILY_REVIEW_CAP,
  REVIEW_CYCLE_CONFIG,
  REVIEW_SET_ID,
  SCHEDULE_REBUILD_BATCH,
  SCHEDULE_VERSION,
  SCHEDULER_PARAMS_VERSION,
} from './constants';
export { gradeForAttempt, isCleanFastSolve } from './grade';
export {
  applyGrade,
  isScheduleCorrupt,
  isScheduleStale,
  scheduleFromHistory,
  scheduleRowFrom,
  type PuzzleScheduleRow,
} from './projection';
export {
  dueQueue,
  normalizeCaps,
  type DueQueueInput,
  type DueSchedule,
  type RawReviewCaps,
} from './dueQueue';
export { dayUsageOf, type DayUsageInput } from './dayUsage';
