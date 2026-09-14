/**
 * Feature 020 — deterministic grade mapping (pure).
 *
 * Maps an immutable `PuzzleAttemptRow` to the scheduler's rating vocabulary,
 * versioned by `GRADE_MAPPING_VERSION` (a change also bumps `SCHEDULE_VERSION`
 * so the derived projection rebuilds). Latency only modulates the clean
 * `solvedFirstTry` case; it never upgrades a helped or failed outcome.
 */

import type { PuzzleAttemptRow } from '@/domain/training/types';
import { EASY_SOLVE_MS } from './constants';
import type { Grade } from './types';

/**
 * Whether a `solvedFirstTry` presentation was clean (no hint, no wrong move,
 * no restart) and fast enough to grade `easy`. Mirrors the mastery legitimacy
 * rule's clean-line condition.
 */
export function isCleanFastSolve(attempt: PuzzleAttemptRow): boolean {
  return (
    attempt.hintCount === 0 &&
    attempt.wrongMoveCount === 0 &&
    (attempt.restartCount ?? 0) === 0 &&
    attempt.solvingTimeMs <= EASY_SOLVE_MS
  );
}

/**
 * Derive the grade for one attempt, or `null` when it produces no grade.
 *
 * - `skipped` → `null` (no row is graded; discarded presentations never reach
 *   this function);
 * - `failed` → `again`;
 * - `solvedWithHelp` → `hard`;
 * - `solvedFirstTry`: a defensive counter (`hintCount`/`wrongMoveCount`/
 *   `restartCount`) downgrades to `hard`; otherwise a clean solve at or below
 *   `EASY_SOLVE_MS` is `easy`, a slower clean solve is `good`.
 */
export function gradeForAttempt(attempt: PuzzleAttemptRow): Grade | null {
  if (attempt.result === 'skipped') {
    return null;
  }
  if (attempt.result === 'failed') {
    return 'again';
  }
  if (attempt.result === 'solvedWithHelp') {
    return 'hard';
  }
  if (attempt.hintCount > 0 || attempt.wrongMoveCount > 0 || (attempt.restartCount ?? 0) > 0) {
    return 'hard';
  }
  return attempt.solvingTimeMs <= EASY_SOLVE_MS ? 'easy' : 'good';
}
