/**
 * Feature 020 — schedule projection (pure).
 *
 * The deterministic fold from a puzzle's immutable attempt history to its
 * `ScheduleState`, plus the incremental `applyGrade` path and the staleness
 * check. `scheduleFromHistory` and `applyGrade` take the injected `Scheduler`,
 * so this module stays free of the scheduler library; tests inject a fake.
 *
 * Invariant (domain/review-scheduling.md #3): for a valid prior state,
 * `applyGrade(state, grade, at)` equals the corresponding fold step, so the
 * derived row is exactly rebuildable.
 */

import type { PuzzleAttemptRow } from '@/domain/training/types';
import { SCHEDULE_VERSION, SCHEDULER_PARAMS_VERSION } from './constants';
import { gradeForAttempt } from './grade';
import type { Grade, Scheduler, ScheduleState } from './types';

/**
 * The persisted derived row: the serializable `ScheduleState` plus the owning
 * `puzzleId`, the last applied grade and the version stamps that gate lazy
 * rebuilds. It is a cache — droppable and rebuildable from `puzzleAttempts`.
 */
export interface PuzzleScheduleRow extends ScheduleState {
  /** Owning puzzle id (primary key). */
  readonly puzzleId: string;
  /** The last applied grade, or `null` when none has been applied. */
  readonly lastGrade: Grade | null;
  /** Projection/grade-mapping semantics version. */
  readonly scheduleVersion: number;
  /** Scheduler parameter-set version. */
  readonly schedulerParamsVersion: number;
  /** Last-write timestamp (schema-v12 merge convention). */
  readonly updatedAt: number;
}

/**
 * Fold a puzzle's gradeable attempts (`result !== 'skipped'`) in chronological
 * order (by `endedAt`, then `presentationIndex`) from `initialState` through
 * `next`. Returns `null` when no attempt is gradeable (the puzzle stays new).
 * Deterministic and input-non-mutating.
 */
export function scheduleFromHistory(
  scheduler: Scheduler,
  attempts: readonly PuzzleAttemptRow[],
): ScheduleState | null {
  const gradeable = attempts.filter((attempt) => attempt.result !== 'skipped');
  if (gradeable.length === 0) {
    return null;
  }
  const ordered = [...gradeable].sort(compareAttemptOrder);
  let state = scheduler.initialState(ordered[0]!.endedAt);
  for (const attempt of ordered) {
    const grade = gradeForAttempt(attempt);
    if (grade === null) {
      continue;
    }
    state = scheduler.next(state, grade, attempt.endedAt);
  }
  return state;
}

/**
 * The incremental path: apply one grade at `at` to a known state. Equal to the
 * corresponding `scheduleFromHistory` fold step (invariant 3).
 */
export function applyGrade(
  scheduler: Scheduler,
  state: ScheduleState,
  grade: Grade,
  at: number,
): ScheduleState {
  return scheduler.next(state, grade, at);
}

/**
 * Build the persisted row from a projected state. Stamps the current
 * `SCHEDULE_VERSION`/`SCHEDULER_PARAMS_VERSION` so a later rebuild can detect
 * staleness, and records the last applied grade.
 */
export function scheduleRowFrom(
  state: ScheduleState,
  puzzleId: string,
  lastGrade: Grade | null,
  updatedAt: number,
): PuzzleScheduleRow {
  return {
    ...state,
    puzzleId,
    lastGrade,
    scheduleVersion: SCHEDULE_VERSION,
    schedulerParamsVersion: SCHEDULER_PARAMS_VERSION,
    updatedAt,
  };
}

/** Whether a stored row was written under an older projection/parameter set. */
export function isScheduleStale(row: {
  readonly scheduleVersion: number;
  readonly schedulerParamsVersion: number;
}): boolean {
  return (
    row.scheduleVersion !== SCHEDULE_VERSION ||
    row.schedulerParamsVersion !== SCHEDULER_PARAMS_VERSION
  );
}

const PHASES: readonly ScheduleState['state'][] = ['learning', 'review', 'relearning'];

/**
 * Whether a stored row is malformed (a partially written / hand-edited row):
 * a non-finite numeric field, an invalid `lastReviewedAt`, or an unknown
 * phase. A corrupt row is never trusted and is rebuilt from history.
 */
export function isScheduleCorrupt(row: Partial<ScheduleState>): boolean {
  const numbers = [
    row.dueAt,
    row.stability,
    row.difficulty,
    row.elapsedDays,
    row.scheduledDays,
    row.reps,
    row.lapses,
    row.learningStep,
  ];
  if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return true;
  }
  if (
    row.lastReviewedAt !== null &&
    (typeof row.lastReviewedAt !== 'number' || !Number.isFinite(row.lastReviewedAt))
  ) {
    return true;
  }
  return !PHASES.includes(row.state as ScheduleState['state']);
}

/** Chronological attempt order: `endedAt`, then `presentationIndex`. */
function compareAttemptOrder(a: PuzzleAttemptRow, b: PuzzleAttemptRow): number {
  return a.endedAt - b.endedAt || a.presentationIndex - b.presentationIndex;
}
