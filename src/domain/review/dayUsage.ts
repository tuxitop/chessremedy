/**
 * Feature 020 — derived per-local-day cap usage (pure).
 *
 * Derives how many new/review puzzles were presented today from the persisted
 * rows alone — no extra table (O-8). A puzzle presented in today's review
 * cycles counts as **new** when its earliest gradeable attempt overall is not
 * earlier than its earliest today review-session start, otherwise as a
 * **review**; each puzzle counts once.
 */

import { REVIEW_SET_ID } from '@/domain/training/autoSet';
import { isSameLocalCalendarDay } from '@/domain/training/cycleMetrics';
import type { TrainingCycleRow } from '@/domain/training/cycleTypes';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import type { DayUsage } from './types';

/** Inputs to `dayUsageOf`. */
export interface DayUsageInput {
  /** Every persisted training cycle. */
  readonly cycles: readonly TrainingCycleRow[];
  /** Every persisted attempt row. */
  readonly attempts: readonly PuzzleAttemptRow[];
  /** Current instant, Unix epoch millis (local calendar day boundary). */
  readonly now: number;
}

/**
 * Derive today's new/review usage. Deterministic and input-non-mutating; an
 * empty day (or no review cycles) yields `{ newCount: 0, reviewCount: 0 }`.
 */
export function dayUsageOf(input: DayUsageInput): DayUsage {
  const startByCycle = new Map<string, number>();
  for (const cycle of input.cycles) {
    if (
      cycle.trainingSetId === REVIEW_SET_ID &&
      isSameLocalCalendarDay(cycle.startedAt, input.now)
    ) {
      startByCycle.set(cycle.id, cycle.startedAt);
    }
  }

  // The earliest today review-session start at which each puzzle was presented.
  const presentedAt = new Map<string, number>();
  for (const attempt of input.attempts) {
    const start = startByCycle.get(attempt.cycleId);
    if (start === undefined) {
      continue;
    }
    const current = presentedAt.get(attempt.puzzleId);
    if (current === undefined || start < current) {
      presentedAt.set(attempt.puzzleId, start);
    }
  }

  // The earliest gradeable attempt overall for each puzzle (any cycle/day).
  const earliestGradeable = new Map<string, { endedAt: number; presentationIndex: number }>();
  for (const attempt of input.attempts) {
    if (attempt.result === 'skipped') {
      continue;
    }
    const current = earliestGradeable.get(attempt.puzzleId);
    if (
      current === undefined ||
      attempt.endedAt < current.endedAt ||
      (attempt.endedAt === current.endedAt && attempt.presentationIndex < current.presentationIndex)
    ) {
      earliestGradeable.set(attempt.puzzleId, {
        endedAt: attempt.endedAt,
        presentationIndex: attempt.presentationIndex,
      });
    }
  }

  let newCount = 0;
  let reviewCount = 0;
  for (const [puzzleId, sessionStart] of presentedAt) {
    const first = earliestGradeable.get(puzzleId);
    if (first === undefined || first.endedAt >= sessionStart) {
      newCount += 1;
    } else {
      reviewCount += 1;
    }
  }
  return { newCount, reviewCount };
}
