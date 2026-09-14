/**
 * Feature 020 — deterministic review-scheduling fixtures (domain).
 *
 * A pure `fakeScheduler` (no library, no IndexedDB) whose `next` is a
 * deterministic function of `(state, grade, at)`, so `applyGrade` equals the
 * corresponding `scheduleFromHistory` fold step; plus schedule/row/cycle/
 * attempt fixtures. Every value is fixed and input-non-mutating.
 */

import { puzzleIdOf } from '@/domain/puzzle/id';
import { PUZZLE_FIXTURE_NOW, puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { cycleFixture } from '@/domain/training/test-support';
import type { TrainingCycleRow } from '@/domain/training/cycleTypes';
import type { PuzzleAttemptRow, TrainingResult } from '@/domain/training/types';
import { REVIEW_SET_ID, SCHEDULE_VERSION, SCHEDULER_PARAMS_VERSION } from './constants';
import { scheduleRowFrom, type PuzzleScheduleRow } from './projection';
import type { Grade, Scheduler, ScheduleState } from './types';

/** One day in millis. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** A deterministic fixed clock for review fixtures. */
export const REVIEW_FIXTURE_NOW = PUZZLE_FIXTURE_NOW;

/** Fixed scheduled interval (days) per grade, for the fake scheduler. */
const FAKE_INTERVALS: Readonly<Record<Grade, number>> = {
  again: 0,
  hard: 1,
  good: 3,
  easy: 7,
};

function advance(state: ScheduleState, grade: Grade, at: number): ScheduleState {
  const days = FAKE_INTERVALS[grade];
  return {
    dueAt: at + days * DAY_MS,
    lastReviewedAt: at,
    state: grade === 'again' ? 'relearning' : 'review',
    stability: state.stability + days,
    difficulty: state.difficulty,
    elapsedDays:
      state.lastReviewedAt === null ? 0 : Math.round((at - state.lastReviewedAt) / DAY_MS),
    scheduledDays: days,
    reps: state.reps + 1,
    lapses: state.lapses + (grade === 'again' ? 1 : 0),
    learningStep: 0,
  };
}

/**
 * A deterministic in-memory `Scheduler` for domain/projection tests. No
 * library import; `next` is a pure function of its inputs.
 */
export const fakeScheduler: Scheduler = {
  initialState(now: number): ScheduleState {
    return {
      dueAt: now,
      lastReviewedAt: null,
      state: 'learning',
      stability: 0,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      learningStep: 0,
    };
  },
  preview(state: ScheduleState, now: number): Record<Grade, ScheduleState> {
    return {
      again: advance(state, 'again', now),
      hard: advance(state, 'hard', now),
      good: advance(state, 'good', now),
      easy: advance(state, 'easy', now),
    };
  },
  next(state: ScheduleState, grade: Grade, at: number): ScheduleState {
    return advance(state, grade, at);
  },
  retrievability(state: ScheduleState, now: number): number {
    if (state.lastReviewedAt === null) {
      return 0;
    }
    const interval = Math.max(1, state.scheduledDays) * DAY_MS;
    const elapsed = Math.max(0, now - state.lastReviewedAt);
    return Math.max(0, Math.min(1, 1 - elapsed / (2 * interval)));
  },
};

/** Overrides for `scheduleStateFixture`; every field defaults deterministically. */
export interface ScheduleStateFixtureOverrides {
  readonly dueAt?: number;
  readonly lastReviewedAt?: number | null;
  readonly state?: ScheduleState['state'];
  readonly stability?: number;
  readonly difficulty?: number;
  readonly elapsedDays?: number;
  readonly scheduledDays?: number;
  readonly reps?: number;
  readonly lapses?: number;
  readonly learningStep?: number;
}

/** A deterministic `ScheduleState` (default: an unscheduled learning card). */
export function scheduleStateFixture(overrides: ScheduleStateFixtureOverrides = {}): ScheduleState {
  return {
    dueAt: overrides.dueAt ?? REVIEW_FIXTURE_NOW,
    lastReviewedAt: overrides.lastReviewedAt ?? null,
    state: overrides.state ?? 'learning',
    stability: overrides.stability ?? 0,
    difficulty: overrides.difficulty ?? 5,
    elapsedDays: overrides.elapsedDays ?? 0,
    scheduledDays: overrides.scheduledDays ?? 0,
    reps: overrides.reps ?? 0,
    lapses: overrides.lapses ?? 0,
    learningStep: overrides.learningStep ?? 0,
  };
}

/** Overrides for `puzzleScheduleRowFixture`. */
export interface PuzzleScheduleRowFixtureOverrides extends ScheduleStateFixtureOverrides {
  readonly puzzleId?: string;
  readonly lastGrade?: Grade | null;
  readonly scheduleVersion?: number;
  readonly schedulerParamsVersion?: number;
  readonly updatedAt?: number;
}

/** A deterministic persisted schedule row. */
export function puzzleScheduleRowFixture(
  overrides: PuzzleScheduleRowFixtureOverrides = {},
): PuzzleScheduleRow {
  const state = scheduleStateFixture(overrides);
  const row = scheduleRowFrom(
    state,
    overrides.puzzleId ?? puzzleIdOf('fixture:mate-one', 6),
    overrides.lastGrade ?? null,
    overrides.updatedAt ?? REVIEW_FIXTURE_NOW,
  );
  return {
    ...row,
    scheduleVersion: overrides.scheduleVersion ?? SCHEDULE_VERSION,
    schedulerParamsVersion: overrides.schedulerParamsVersion ?? SCHEDULER_PARAMS_VERSION,
  };
}

/** Overrides for `reviewCycleFixture`. */
export interface ReviewCycleFixtureOverrides {
  readonly id?: string;
  readonly cycleNumber?: number;
  readonly startedAt?: number;
  readonly puzzleIds?: readonly string[];
  readonly status?: TrainingCycleRow['status'];
}

/** A deterministic review-sentinel cycle (`trainingSetId === REVIEW_SET_ID`). */
export function reviewCycleFixture(overrides: ReviewCycleFixtureOverrides = {}): TrainingCycleRow {
  return cycleFixture({
    id: overrides.id ?? 'fixture:review-cycle',
    trainingSetId: REVIEW_SET_ID,
    cycleNumber: overrides.cycleNumber ?? 1,
    startedAt: overrides.startedAt ?? REVIEW_FIXTURE_NOW,
    puzzleIds: overrides.puzzleIds ?? [],
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
  });
}

/** Overrides for `reviewAttemptFixture`. */
export interface ReviewAttemptFixtureOverrides {
  readonly puzzleId?: string;
  readonly trainingSetId?: string;
  readonly cycleId?: string;
  readonly result?: TrainingResult;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly solvingTimeMs?: number;
  readonly wrongMoveCount?: number;
  readonly hintCount?: number;
  readonly restartCount?: number;
  readonly presentationIndex?: number;
}

/** A deterministic attempt row under the review sentinel. */
export function reviewAttemptFixture(
  overrides: ReviewAttemptFixtureOverrides = {},
): PuzzleAttemptRow {
  const result = overrides.result ?? 'solvedFirstTry';
  const startedAt = overrides.startedAt ?? REVIEW_FIXTURE_NOW;
  const solvingTimeMs = overrides.solvingTimeMs ?? 5_000;
  return {
    puzzleId: overrides.puzzleId ?? puzzleIdOf('fixture:mate-one', 6),
    trainingSetId: overrides.trainingSetId ?? REVIEW_SET_ID,
    cycleId: overrides.cycleId ?? 'fixture:review-cycle',
    presentationIndex: overrides.presentationIndex ?? 1,
    startedAt,
    endedAt: overrides.endedAt ?? startedAt + solvingTimeMs,
    result,
    solvingTimeMs,
    wrongMoveCount: overrides.wrongMoveCount ?? (result === 'failed' ? 1 : 0),
    hintCount: overrides.hintCount ?? (result === 'solvedWithHelp' ? 1 : 0),
    highestHintLevel: result === 'solvedWithHelp' ? 2 : null,
    restartCount: overrides.restartCount ?? 0,
    solved: result === 'solvedFirstTry' || result === 'solvedWithHelp',
    puzzleGeneratorVersion: puzzleRowFixture('mate-one').puzzleGeneratorVersion,
    origin: 'tactical',
  };
}

/** A review pool row fixture with a chosen difficulty. */
export function reviewPoolRowFixture(index: number, difficulty: number): PuzzleRow {
  return {
    ...puzzleRowFixture('mate-one'),
    sourceGameId: `fixture:review-${index}`,
    sourcePly: index,
    difficulty,
  };
}
