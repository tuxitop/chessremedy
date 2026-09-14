import { describe, expect, it } from 'vitest';
import { puzzleIdOf } from '@/domain/puzzle/id';
import {
  DEFAULT_DAILY_NEW_CAP,
  DEFAULT_DAILY_REVIEW_CAP,
  MAX_DAILY_NEW_CAP,
  MAX_DAILY_REVIEW_CAP,
} from './constants';
import { dueQueue, normalizeCaps, type DueQueueInput } from './dueQueue';
import { reviewPoolRowFixture } from './test-support';

const NOW = 1_700_000_000_000;

function puzzle(index: number, difficulty: number) {
  const row = reviewPoolRowFixture(index, difficulty);
  return { row, id: puzzleIdOf(row.sourceGameId, row.sourcePly) };
}

function baseInput(overrides: Partial<DueQueueInput> = {}): DueQueueInput {
  return {
    schedules: [],
    puzzles: [],
    pool: [],
    now: NOW,
    caps: { newCap: DEFAULT_DAILY_NEW_CAP, reviewCap: DEFAULT_DAILY_REVIEW_CAP },
    dayUsage: { newCount: 0, reviewCount: 0 },
    pendingRebuildIds: new Set(),
    ...overrides,
  };
}

describe('normalizeCaps (Feature 020 §Daily caps)', () => {
  it('falls back to defaults for absent/invalid values', () => {
    expect(normalizeCaps({})).toEqual({
      newCap: DEFAULT_DAILY_NEW_CAP,
      reviewCap: DEFAULT_DAILY_REVIEW_CAP,
    });
    expect(normalizeCaps({ newCap: 'x', reviewCap: Number.NaN })).toEqual({
      newCap: DEFAULT_DAILY_NEW_CAP,
      reviewCap: DEFAULT_DAILY_REVIEW_CAP,
    });
  });

  it('keeps 0 (paused) and clamps negatives to 0 and large values to the max', () => {
    expect(normalizeCaps({ newCap: 0, reviewCap: 0 })).toEqual({ newCap: 0, reviewCap: 0 });
    expect(normalizeCaps({ newCap: -5, reviewCap: -1 })).toEqual({ newCap: 0, reviewCap: 0 });
    expect(normalizeCaps({ newCap: 999_999, reviewCap: 999_999 })).toEqual({
      newCap: MAX_DAILY_NEW_CAP,
      reviewCap: MAX_DAILY_REVIEW_CAP,
    });
  });
});

describe('dueQueue (Feature 020 §Due queue)', () => {
  it('returns due reviews first, ordered by dueAt then difficulty then id', () => {
    const a = puzzle(1, 30);
    const b = puzzle(2, 10);
    const c = puzzle(3, 20);
    const queue = dueQueue(
      baseInput({
        puzzles: [a.row, b.row, c.row],
        schedules: [
          { puzzleId: a.id, dueAt: NOW - 100 },
          { puzzleId: b.id, dueAt: NOW - 100 },
          { puzzleId: c.id, dueAt: NOW - 200 },
        ],
      }),
    );
    expect(queue.map((entry) => entry.puzzleId)).toEqual([c.id, b.id, a.id]);
    expect(queue.every((entry) => entry.kind === 'review')).toBe(true);
  });

  it('excludes future schedules from the due reviews', () => {
    const a = puzzle(1, 10);
    const queue = dueQueue(
      baseInput({
        puzzles: [a.row],
        schedules: [{ puzzleId: a.id, dueAt: NOW + 1 }],
      }),
    );
    expect(queue).toEqual([]);
  });

  it('appends new intake from the pool in difficulty order', () => {
    const a = puzzle(1, 30);
    const b = puzzle(2, 10);
    const c = puzzle(3, 20);
    const queue = dueQueue(
      baseInput({ puzzles: [a.row, b.row, c.row], pool: [a.row, b.row, c.row] }),
    );
    expect(queue.map((entry) => entry.puzzleId)).toEqual([b.id, c.id, a.id]);
    expect(queue.every((entry) => entry.kind === 'new' && entry.dueAt === null)).toBe(true);
  });

  it('excludes scheduled and pending-rebuild puzzles from intake', () => {
    const a = puzzle(1, 10);
    const b = puzzle(2, 20);
    const c = puzzle(3, 30);
    const queue = dueQueue(
      baseInput({
        puzzles: [a.row, b.row, c.row],
        pool: [a.row, b.row, c.row],
        schedules: [{ puzzleId: a.id, dueAt: NOW + 10_000 }],
        pendingRebuildIds: new Set([b.id]),
      }),
    );
    expect(queue.map((entry) => entry.puzzleId)).toEqual([c.id]);
  });

  it('bounds due reviews and intake by the remaining allowance', () => {
    const a = puzzle(1, 10);
    const b = puzzle(2, 20);
    const c = puzzle(3, 30);
    const queue = dueQueue(
      baseInput({
        puzzles: [a.row, b.row, c.row],
        pool: [a.row, b.row, c.row],
        schedules: [
          { puzzleId: a.id, dueAt: NOW - 3 },
          { puzzleId: b.id, dueAt: NOW - 2 },
        ],
        caps: { newCap: 1, reviewCap: 1 },
        dayUsage: { newCount: 0, reviewCount: 0 },
      }),
    );
    expect(queue.filter((entry) => entry.kind === 'review')).toHaveLength(1);
    expect(queue.filter((entry) => entry.kind === 'new')).toHaveLength(1);
  });

  it('pauses a category when its cap is 0', () => {
    const a = puzzle(1, 10);
    const b = puzzle(2, 20);
    const reviewsOnly = dueQueue(
      baseInput({
        puzzles: [a.row, b.row],
        pool: [a.row, b.row],
        schedules: [{ puzzleId: a.id, dueAt: NOW - 1 }],
        caps: { newCap: 0, reviewCap: 10 },
      }),
    );
    expect(reviewsOnly.map((entry) => entry.puzzleId)).toEqual([a.id]);

    const intakeOnly = dueQueue(
      baseInput({
        puzzles: [a.row, b.row],
        pool: [a.row, b.row],
        schedules: [{ puzzleId: a.id, dueAt: NOW - 1 }],
        caps: { newCap: 10, reviewCap: 0 },
      }),
    );
    expect(intakeOnly.map((entry) => entry.puzzleId)).toEqual([b.id]);
  });

  it('accounts for already-used daily allowance', () => {
    const a = puzzle(1, 10);
    const queue = dueQueue(
      baseInput({
        puzzles: [a.row],
        pool: [a.row],
        caps: { newCap: 5, reviewCap: 5 },
        dayUsage: { newCount: 5, reviewCount: 0 },
      }),
    );
    expect(queue).toEqual([]);
  });

  it('returns an empty queue when there is nothing due and no intake', () => {
    expect(dueQueue(baseInput())).toEqual([]);
  });
});
