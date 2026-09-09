/**
 * PuzzleAttemptRecorder tests (Feature 012, Stage C).
 *
 * Deterministic service tests over an in-memory fake of the
 * `PuzzleAttemptsRepository` (no Dexie/IndexedDB, no engine, no network): the
 * recorder persists exactly one immutable row per outcome, first-write-wins
 * idempotency (`'written'` → duplicate `'already-written'`), a genuine write
 * failure **throws** a `PuzzleAttemptWriteError` (never silently dropped — a
 * retry after it records cleanly, and an ambiguous prior write that landed
 * resolves `'already-written'` on retry), and an omitted `endedAt` is stamped
 * by the injected clock.
 */

import { describe, expect, it } from 'vitest';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { buildAttemptRow } from '@/domain/training/outcome';
import type { PuzzleAttemptRow, SessionPuzzleContext } from '@/domain/training/types';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import {
  PuzzleAttemptRecorder,
  PuzzleAttemptWriteError,
  type RecordAttemptInput,
} from './attempts-service';

const NOW = 1_700_000_000_000;
const CYCLE_ID = 'fixture:cycle';
const ROW: PuzzleRow = puzzleRowFixture('mate-two');

/** In-memory `PuzzleAttemptsRepository` fake with scriptable write failures. */
class FakeAttemptsRepository implements PuzzleAttemptsRepository {
  readonly rows = new Map<string, PuzzleAttemptRow>();
  /** When set, the next `addAttempt` rejects BEFORE writing (clean failure). */
  failNextAdd = false;
  /** When set, the next `addAttempt` writes the row then rejects (ambiguous). */
  failAfterNextAdd = false;

  private keyOf(cycleId: string, puzzleId: string, presentationIndex: number): string {
    return `${cycleId}\u0000${puzzleId}\u0000${presentationIndex}`;
  }

  addAttempt(row: PuzzleAttemptRow): Promise<'added' | 'already-present'> {
    const key = this.keyOf(row.cycleId, row.puzzleId, row.presentationIndex);
    if (this.failNextAdd) {
      this.failNextAdd = false;
      return Promise.reject(new Error('simulated persistence failure'));
    }
    if (this.failAfterNextAdd) {
      this.failAfterNextAdd = false;
      this.rows.set(key, row);
      return Promise.reject(new Error('simulated ambiguous persistence failure'));
    }
    if (this.rows.has(key)) {
      return Promise.resolve('already-present');
    }
    this.rows.set(key, row);
    return Promise.resolve('added');
  }

  getAttempt(
    cycleId: string,
    puzzleId: string,
    presentationIndex: number,
  ): Promise<PuzzleAttemptRow | undefined> {
    return Promise.resolve(this.rows.get(this.keyOf(cycleId, puzzleId, presentationIndex)));
  }

  listForCycle(cycleId: string): Promise<PuzzleAttemptRow[]> {
    const list = [...this.rows.values()].filter((row) => row.cycleId === cycleId);
    return Promise.resolve(list);
  }

  listForPuzzle(puzzleId: string): Promise<PuzzleAttemptRow[]> {
    const list = [...this.rows.values()].filter((row) => row.puzzleId === puzzleId);
    return Promise.resolve(list);
  }

  listForCycleAndPuzzle(cycleId: string, puzzleId: string): Promise<PuzzleAttemptRow[]> {
    const list = [...this.rows.values()].filter(
      (row) => row.cycleId === cycleId && row.puzzleId === puzzleId,
    );
    return Promise.resolve(list);
  }

  deleteForPuzzleIds(puzzleIds: readonly string[]): Promise<void> {
    const set = new Set(puzzleIds);
    for (const [key, row] of this.rows) {
      if (set.has(row.puzzleId)) {
        this.rows.delete(key);
      }
    }
    return Promise.resolve();
  }
}

function context(presentationIndex: number): SessionPuzzleContext {
  return { trainingSetId: 'fixture:set', cycleId: CYCLE_ID, presentationIndex };
}

function recordInput(overrides: Partial<RecordAttemptInput> = {}): RecordAttemptInput {
  return {
    row: ROW,
    context: context(1),
    trigger: 'solved',
    counters: { wrongMoveCount: 0, hintCount: 0, highestHintLevel: null },
    startedAt: NOW - 5_000,
    endedAt: NOW,
    ...overrides,
  };
}

describe('PuzzleAttemptRecorder', () => {
  it('persists exactly one immutable row for a first outcome', async () => {
    const attempts = new FakeAttemptsRepository();
    const recorder = new PuzzleAttemptRecorder({ attempts });
    const input = recordInput();

    const result = await recorder.record(input);

    expect(result.status).toBe('written');
    expect(result.attemptRow).toEqual(buildAttemptRow({ ...input, endedAt: NOW }));
    expect(result.attemptRow.result).toBe('solvedFirstTry');
    expect(result.attemptRow.solved).toBe(true);
    expect(attempts.rows.size).toBe(1);
    const stored = await attempts.getAttempt(
      CYCLE_ID,
      puzzleIdOf(ROW.sourceGameId, ROW.sourcePly),
      1,
    );
    expect(stored).toEqual(buildAttemptRow({ ...input, endedAt: NOW }));
  });

  it('a duplicate record of the same outcome is idempotent and leaves the row untouched', async () => {
    const attempts = new FakeAttemptsRepository();
    const recorder = new PuzzleAttemptRecorder({ attempts });
    const input = recordInput();

    const first = await recorder.record(input);
    const second = await recorder.record(input);

    expect(first.status).toBe('written');
    expect(second.status).toBe('already-written');
    expect(attempts.rows.size).toBe(1);
    const stored = await attempts.getAttempt(
      CYCLE_ID,
      puzzleIdOf(ROW.sourceGameId, ROW.sourcePly),
      1,
    );
    expect(stored).toEqual(buildAttemptRow({ ...input, endedAt: NOW }));
  });

  it('a genuine write failure throws (never silently dropped) and a retry records cleanly', async () => {
    const attempts = new FakeAttemptsRepository();
    const recorder = new PuzzleAttemptRecorder({ attempts });
    attempts.failNextAdd = true;

    const failure = recorder.record(recordInput());
    await expect(failure).rejects.toThrow(PuzzleAttemptWriteError);
    const error = await failure.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PuzzleAttemptWriteError);
    if (error instanceof PuzzleAttemptWriteError) {
      // The wrapper carries the immutable row + the underlying repository error.
      expect(error.attemptRow.result).toBe('solvedFirstTry');
      expect(error.cause).toBeInstanceOf(Error);
    }
    expect(attempts.rows.size).toBe(0);

    const retried = await recorder.record(recordInput());
    expect(retried.status).toBe('written');
    expect(attempts.rows.size).toBe(1);
  });

  it('an ambiguous prior write that landed throws once, then resolves as already-written on retry', async () => {
    const attempts = new FakeAttemptsRepository();
    const recorder = new PuzzleAttemptRecorder({ attempts });
    attempts.failAfterNextAdd = true;

    const failure = recorder.record(recordInput());
    await expect(failure).rejects.toThrow(PuzzleAttemptWriteError);
    expect(attempts.rows.size).toBe(1);

    const retried = await recorder.record(recordInput());
    expect(retried.status).toBe('already-written');
    expect(attempts.rows.size).toBe(1);
  });

  it('omitted endedAt is stamped by the injected clock (deterministic solving time)', async () => {
    const attempts = new FakeAttemptsRepository();
    const clock = () => NOW;
    const recorder = new PuzzleAttemptRecorder({ attempts, now: clock });
    const input: RecordAttemptInput = {
      row: ROW,
      context: context(1),
      trigger: 'solved',
      counters: { wrongMoveCount: 0, hintCount: 0, highestHintLevel: null },
      startedAt: NOW - 5_000,
    };

    const result = await recorder.record(input);

    expect(result.status).toBe('written');
    const stored = await attempts.getAttempt(
      CYCLE_ID,
      puzzleIdOf(ROW.sourceGameId, ROW.sourcePly),
      1,
    );
    expect(stored?.endedAt).toBe(NOW);
    expect(stored?.solvingTimeMs).toBe(5_000);
  });
});
