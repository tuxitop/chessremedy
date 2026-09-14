import { describe, expect, it } from 'vitest';
import { GRADE_MAPPING_VERSION } from './constants';
import { gradeForAttempt, isCleanFastSolve } from './grade';
import { reviewAttemptFixture } from './test-support';

describe('gradeForAttempt (Feature 020 §Grade mapping)', () => {
  it('maps failed to again and solvedWithHelp to hard', () => {
    expect(gradeForAttempt(reviewAttemptFixture({ result: 'failed' }))).toBe('again');
    expect(gradeForAttempt(reviewAttemptFixture({ result: 'solvedWithHelp' }))).toBe('hard');
  });

  it('maps a clean fast solvedFirstTry to easy', () => {
    const attempt = reviewAttemptFixture({
      result: 'solvedFirstTry',
      solvingTimeMs: 9_999,
    });
    expect(isCleanFastSolve(attempt)).toBe(true);
    expect(gradeForAttempt(attempt)).toBe('easy');
  });

  it('maps a clean slow solvedFirstTry to good', () => {
    expect(
      gradeForAttempt(reviewAttemptFixture({ result: 'solvedFirstTry', solvingTimeMs: 10_001 })),
    ).toBe('good');
  });

  it('treats exactly EASY_SOLVE_MS as easy', () => {
    expect(
      gradeForAttempt(reviewAttemptFixture({ result: 'solvedFirstTry', solvingTimeMs: 10_000 })),
    ).toBe('easy');
  });

  it('downgrades a solvedFirstTry carrying a hint/wrong move/restart to hard', () => {
    expect(
      gradeForAttempt(
        reviewAttemptFixture({
          result: 'solvedFirstTry',
          solvingTimeMs: 1_000,
          hintCount: 1,
        }),
      ),
    ).toBe('hard');
    expect(
      gradeForAttempt(
        reviewAttemptFixture({
          result: 'solvedFirstTry',
          solvingTimeMs: 1_000,
          wrongMoveCount: 1,
        }),
      ),
    ).toBe('hard');
    expect(
      gradeForAttempt(
        reviewAttemptFixture({
          result: 'solvedFirstTry',
          solvingTimeMs: 1_000,
          restartCount: 1,
        }),
      ),
    ).toBe('hard');
  });

  it('never upgrades a helped or failed outcome with latency', () => {
    expect(
      gradeForAttempt(reviewAttemptFixture({ result: 'solvedWithHelp', solvingTimeMs: 1_000 })),
    ).toBe('hard');
    expect(gradeForAttempt(reviewAttemptFixture({ result: 'failed', solvingTimeMs: 1_000 }))).toBe(
      'again',
    );
  });

  it('produces no grade for a skipped attempt', () => {
    expect(gradeForAttempt(reviewAttemptFixture({ result: 'skipped' }))).toBeNull();
  });

  it('exposes a grade-mapping version', () => {
    expect(GRADE_MAPPING_VERSION).toBeGreaterThanOrEqual(1);
  });
});
