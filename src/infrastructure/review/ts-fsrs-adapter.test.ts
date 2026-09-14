import { describe, expect, it } from 'vitest';
import { applyGrade, scheduleFromHistory } from '@/domain/review';
import { reviewAttemptFixture } from '@/domain/review/test-support';
import { TsFsrsScheduler, tsFsrsScheduler } from './ts-fsrs-adapter';

const NOW = 1_700_000_000_000;

describe('TsFsrsScheduler (Feature 020 §Adapter)', () => {
  it('produces a serializable initial state with no Date instances', () => {
    const state = tsFsrsScheduler.initialState(NOW);
    expect(state.dueAt).toBe(NOW);
    expect(state.lastReviewedAt).toBeNull();
    expect(state.state).toBe('learning');
    expect(hasDateInstance(state)).toBe(false);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('advances deterministically for an injected clock', () => {
    const first = tsFsrsScheduler.next(tsFsrsScheduler.initialState(NOW), 'good', NOW);
    const second = tsFsrsScheduler.next(tsFsrsScheduler.initialState(NOW), 'good', NOW);
    expect(second).toEqual(first);
    expect(first.dueAt).toBeGreaterThanOrEqual(NOW);
    expect(first.reps).toBe(1);
    expect(first.lastReviewedAt).toBe(NOW);
  });

  it('previews every grade without mutating the input state', () => {
    const state = tsFsrsScheduler.initialState(NOW);
    const before = { ...state };
    const preview = tsFsrsScheduler.preview(state, NOW);
    expect(Object.keys(preview).sort()).toEqual(['again', 'easy', 'good', 'hard']);
    expect(state).toEqual(before);
    expect(preview.good).toEqual(tsFsrsScheduler.next(state, 'good', NOW));
  });

  it('clamps retrievability into [0, 1]', () => {
    const state = tsFsrsScheduler.next(tsFsrsScheduler.initialState(NOW), 'good', NOW);
    const value = tsFsrsScheduler.retrievability(state, NOW);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it('keeps applyGrade equal to a full scheduleFromHistory fold (fuzz disabled)', () => {
    const base = NOW;
    const attempts = [
      reviewAttemptFixture({ puzzleId: 'p:1', endedAt: base, solvingTimeMs: 4_000 }),
      reviewAttemptFixture({
        puzzleId: 'p:1',
        endedAt: base + 3 * 24 * 60 * 60 * 1000,
        solvingTimeMs: 40_000,
      }),
      reviewAttemptFixture({
        puzzleId: 'p:1',
        endedAt: base + 10 * 24 * 60 * 60 * 1000,
        result: 'failed',
      }),
    ];
    const full = scheduleFromHistory(tsFsrsScheduler, attempts);
    let incremental = tsFsrsScheduler.initialState(attempts[0]!.endedAt);
    incremental = applyGrade(tsFsrsScheduler, incremental, 'easy', attempts[0]!.endedAt);
    incremental = applyGrade(tsFsrsScheduler, incremental, 'good', attempts[1]!.endedAt);
    incremental = applyGrade(tsFsrsScheduler, incremental, 'again', attempts[2]!.endedAt);
    expect(incremental).toEqual(full);
  });

  it('is swappable behind the Scheduler interface', () => {
    const scheduler = new TsFsrsScheduler();
    expect(scheduler.initialState(NOW).dueAt).toBe(NOW);
  });
});

function hasDateInstance(value: unknown): boolean {
  if (value instanceof Date) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasDateInstance);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(hasDateInstance);
  }
  return false;
}
