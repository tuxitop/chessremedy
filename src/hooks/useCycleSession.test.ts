/**
 * useCycleSession tests (Feature 013, Stage D).
 *
 * Real Dexie over fake-indexeddb (shared test setup) with a deterministic
 * injected clock/id and a stub recorder that writes through the real attempts
 * repository. Covers: snapshot ordering, all three `retryFailed` modes, skips,
 * completion, resume after a simulated reload, missing puzzle rows, exit and
 * write-failure containment. No engine, no network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PuzzleRow } from '@/domain/puzzle';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import {
  buildAttemptRow,
  DEFAULT_CYCLE_CONFIG,
  presentationOutcomeOf,
  type CycleConfig,
  type OutcomeTrigger,
  type PresentationOutcome,
  type RetryFailed,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
  type TrainingResult,
} from '@/domain/training';
import { setFixture } from '@/domain/training/test-support';
import { db } from '@/infrastructure/db/database';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import {
  CycleService,
  PuzzleAttemptWriteError,
  type PuzzleAttemptRecorderLike,
  type RecordAttemptInput,
} from '@/infrastructure/training';
import { useCycleSession, type CycleSessionController } from './useCycleSession';

const NOW = 1_700_000_000_000;
const SET_ID = 'set:one';
let idCounter = 0;
const newId = (): string => `cycle:${(idCounter += 1)}`;

function puzzleFor(gameId: string, ply: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: gameId, sourcePly: ply };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

function makeService(): CycleService {
  return new CycleService({
    cycles: trainingCyclesRepository,
    sets: trainingSetsRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    now: () => NOW,
    newId,
  });
}

/** A stub recorder that persists through the real attempts repository. */
function createRecorder(): { recorder: PuzzleAttemptRecorderLike; calls: RecordAttemptInput[] } {
  const calls: RecordAttemptInput[] = [];
  const recorder: PuzzleAttemptRecorderLike = {
    async record(input) {
      calls.push(input);
      const attemptRow = buildAttemptRow({ ...input, endedAt: input.endedAt ?? NOW });
      await attemptsRepository.addAttempt(attemptRow);
      return { status: 'written', attemptRow };
    },
  };
  return { recorder, calls };
}

interface SeededSession {
  readonly set: TacticalTrainingSetRow;
  readonly cycle: TrainingCycleRow;
  readonly map: ReadonlyMap<string, PuzzleRow>;
  readonly service: CycleService;
}

/** Persist the puzzles, a set with that membership, then start a cycle. */
async function seedSession(
  rows: readonly PuzzleRow[],
  options: { readonly setId?: string; readonly config?: Partial<CycleConfig> } = {},
): Promise<SeededSession> {
  if (rows.length > 0) {
    await puzzlesRepository.addIfAbsent(rows);
  }
  const set = setFixture({
    id: options.setId ?? SET_ID,
    puzzleIds: rows.map(idOf),
    config: { ...DEFAULT_CYCLE_CONFIG, ...options.config },
  });
  await trainingSetsRepository.create(set);
  const service = makeService();
  const started = await service.start(set.id);
  if (!started.ok) {
    throw new Error('expected the seeded cycle to start');
  }
  return {
    set,
    cycle: started.cycle,
    map: new Map(rows.map((row) => [idOf(row), row])),
    service,
  };
}

function attemptInput(
  puzzle: PuzzleRow,
  cycleId: string,
  presentationIndex: number,
  result: TrainingResult,
): RecordAttemptInput {
  const trigger: OutcomeTrigger =
    result === 'skipped' ? 'skip' : result === 'failed' ? 'gaveUp' : 'solved';
  return {
    row: puzzle,
    context: { trainingSetId: SET_ID, cycleId, presentationIndex },
    trigger,
    counters: {
      wrongMoveCount: result === 'failed' ? 1 : 0,
      hintCount: result === 'solvedWithHelp' ? 1 : 0,
      highestHintLevel: result === 'solvedWithHelp' ? 2 : null,
    },
    startedAt: NOW,
  };
}

/** Write one presentation through the recorder and return its outcome. */
async function present(
  recorder: PuzzleAttemptRecorderLike,
  puzzle: PuzzleRow,
  cycleId: string,
  presentationIndex: number,
  result: TrainingResult,
): Promise<PresentationOutcome> {
  const { attemptRow } = await recorder.record(
    attemptInput(puzzle, cycleId, presentationIndex, result),
  );
  return presentationOutcomeOf(attemptRow);
}

function renderSession(
  seed: SeededSession,
  recorder: PuzzleAttemptRecorderLike,
  onComplete?: (cycle: TrainingCycleRow) => void,
) {
  return renderHook(() =>
    useCycleSession({
      set: seed.set,
      cycle: seed.cycle,
      puzzles: seed.map,
      recorder,
      attemptsRepository,
      cycleService: seed.service,
      now: () => NOW,
      ...(onComplete === undefined ? {} : { onComplete }),
    }),
  );
}

async function settle(result: { readonly current: CycleSessionController }): Promise<void> {
  await waitFor(() => expect(result.current.status).not.toBe('loading'));
}

describe('useCycleSession (Feature 013, Stage D)', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
    await db.games.clear();
    idCounter = 0;
  });

  it('presents the snapshot in order, advances after each durable outcome and completes', async () => {
    const [p1, p2, p3] = [
      puzzleFor('game:one', 6),
      puzzleFor('game:one', 8),
      puzzleFor('game:one', 10),
    ];
    const seed = await seedSession([p1, p2, p3]);
    const { recorder } = createRecorder();
    const onComplete = vi.fn();
    const { result } = renderSession(seed, recorder, onComplete);
    await settle(result);

    expect(result.current.current?.row).toBe(p1);
    expect(result.current.current?.context).toEqual({
      trainingSetId: SET_ID,
      cycleId: seed.cycle.id,
      presentationIndex: 1,
    });
    expect(result.current.progress).toEqual({ index: 1, total: 3 });
    expect(result.current.allowSkip).toBe(true);

    await act(async () => {
      await result.current.handleOutcome(
        await present(recorder, p1, seed.cycle.id, 1, 'solvedFirstTry'),
      );
    });
    expect(result.current.current?.row).toBe(p2);
    expect(result.current.progress).toEqual({ index: 2, total: 3 });

    await act(async () => {
      await result.current.handleOutcome(
        await present(recorder, p2, seed.cycle.id, 1, 'solvedWithHelp'),
      );
    });
    expect(result.current.current?.row).toBe(p3);

    await act(async () => {
      await result.current.handleOutcome(
        await present(recorder, p3, seed.cycle.id, 1, 'solvedFirstTry'),
      );
    });
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.current).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect((await trainingCyclesRepository.get(seed.cycle.id))?.status).toBe('completed');
  });

  it('applies retryFailed immediate/endOfCycle/none with the 1-based presentation index', async () => {
    const [p1, p2, p3] = [
      puzzleFor('game:one', 6),
      puzzleFor('game:one', 8),
      puzzleFor('game:one', 10),
    ];

    async function scenario(mode: RetryFailed): Promise<string> {
      const seed = await seedSession([p1, p2, p3], {
        setId: `set:${mode}`,
        config: { retryFailed: mode },
      });
      const { recorder } = createRecorder();
      const { result } = renderSession(seed, recorder);
      await settle(result);
      await act(async () => {
        await result.current.handleOutcome(await present(recorder, p1, seed.cycle.id, 1, 'failed'));
      });
      if (result.current.current?.row === p2) {
        // Walk the first pass so the end-of-cycle retry becomes current.
        await act(async () => {
          await result.current.handleOutcome(
            await present(recorder, p2, seed.cycle.id, 1, 'solvedFirstTry'),
          );
        });
        await act(async () => {
          await result.current.handleOutcome(
            await present(recorder, p3, seed.cycle.id, 1, 'solvedFirstTry'),
          );
        });
      }
      const current = result.current.current;
      return current === null
        ? 'none'
        : `${idOf(current.row)}@${current.context.presentationIndex}`;
    }

    expect(await scenario('immediate')).toBe(`${idOf(p1)}@2`);
    expect(await scenario('endOfCycle')).toBe(`${idOf(p1)}@2`);
    expect(await scenario('none')).toBe('none');
  });

  it('retires a skipped puzzle without a retry, excludes it from progress and completes', async () => {
    const [p1, p2] = [puzzleFor('game:one', 6), puzzleFor('game:one', 8)];
    const seed = await seedSession([p1, p2], { config: { retryFailed: 'endOfCycle' } });
    const { recorder } = createRecorder();
    const { result } = renderSession(seed, recorder);
    await settle(result);

    await act(async () => {
      await result.current.handleOutcome(await present(recorder, p1, seed.cycle.id, 1, 'skipped'));
    });
    expect(result.current.current?.row).toBe(p2);
    expect(result.current.progress).toEqual({ index: 2, total: 2 });

    await act(async () => {
      await result.current.handleOutcome(
        await present(recorder, p2, seed.cycle.id, 1, 'solvedFirstTry'),
      );
    });
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect((await trainingCyclesRepository.get(seed.cycle.id))?.status).toBe('completed');
  });

  it('resumes after reload from persisted rows with no stored cursor (idempotent)', async () => {
    const [p1, p2, p3] = [
      puzzleFor('game:one', 6),
      puzzleFor('game:one', 8),
      puzzleFor('game:one', 10),
    ];
    const seed = await seedSession([p1, p2, p3]);
    const { recorder } = createRecorder();
    await present(recorder, p1, seed.cycle.id, 1, 'solvedFirstTry');

    const first = renderSession(seed, recorder);
    await settle(first.result);
    expect(first.result.current.current?.row).toBe(p2);
    expect(first.result.current.progress).toEqual({ index: 2, total: 3 });
    first.unmount();

    // A second mount (a reload) reconstructs the same next presentation.
    const second = renderSession(seed, recorder);
    await settle(second.result);
    expect(second.result.current.current?.row).toBe(p2);
    expect(second.result.current.current?.context.presentationIndex).toBe(1);
    expect(second.result.current.progress).toEqual({ index: 2, total: 3 });
  });

  it('skips missing puzzle rows, notifies and still completes', async () => {
    const p1 = puzzleFor('game:one', 6);
    await puzzlesRepository.addIfAbsent([p1]);
    const set = setFixture({ id: SET_ID, puzzleIds: [idOf(p1), 'ghost:1'] });
    await trainingSetsRepository.create(set);
    const service = makeService();
    const started = await service.start(set.id);
    if (!started.ok) throw new Error('expected start to succeed');
    const map = new Map([[idOf(p1), p1]]);

    const { recorder } = createRecorder();
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useCycleSession({
        set,
        cycle: started.cycle,
        puzzles: map,
        recorder,
        attemptsRepository,
        cycleService: service,
        now: () => NOW,
        onComplete,
      }),
    );
    await settle(result);

    expect(result.current.current?.row).toBe(p1);
    expect(result.current.progress).toEqual({ index: 1, total: 2 });
    expect(result.current.notice).toContain('no longer available');

    await act(async () => {
      await result.current.handleOutcome(
        await present(recorder, p1, started.cycle.id, 1, 'solvedFirstTry'),
      );
    });
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.current).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect((await trainingCyclesRepository.get(started.cycle.id))?.status).toBe('completed');
  });

  it('contains a failed write: an unwritten outcome never advances and the cycle stays inProgress', async () => {
    const p1 = puzzleFor('game:one', 6);
    const seed = await seedSession([p1]);
    const { recorder } = createRecorder();
    const { result } = renderSession(seed, recorder);
    await settle(result);
    expect(result.current.current?.row).toBe(p1);

    // A genuine recorder failure leaves no durable row (Feature 012 keeps the
    // outcome visible and passes `null` to the host).
    const failing: PuzzleAttemptRecorderLike = {
      async record(input) {
        throw new PuzzleAttemptWriteError(
          buildAttemptRow({ ...input, endedAt: NOW }),
          new Error('simulated disk error'),
        );
      },
    };
    await expect(
      failing.record(attemptInput(p1, seed.cycle.id, 1, 'solvedFirstTry')),
    ).rejects.toThrow(PuzzleAttemptWriteError);

    // Discard: the puzzle stays pending at the same index and the cycle is not
    // marked complete while the row is unwritten.
    await act(async () => {
      await result.current.handleOutcome(null);
    });
    expect(result.current.status).toBe('solving');
    expect(result.current.current?.row).toBe(p1);
    expect(result.current.current?.context.presentationIndex).toBe(1);
    expect((await trainingCyclesRepository.get(seed.cycle.id))?.status).toBe('inProgress');
    expect(await attemptsRepository.listForCycle(seed.cycle.id)).toEqual([]);
  });

  it('never advances past a non-durable outcome (persisted rows are the source of truth)', async () => {
    const [p1, p2] = [puzzleFor('game:one', 6), puzzleFor('game:one', 8)];
    const seed = await seedSession([p1, p2]);
    const { recorder } = createRecorder();
    const { result } = renderSession(seed, recorder);
    await settle(result);

    // An outcome whose row was never persisted is ignored: the queue rebuild
    // keeps the same pending puzzle and the same presentation index.
    const phantom = presentationOutcomeOf(
      buildAttemptRow({ ...attemptInput(p1, seed.cycle.id, 1, 'solvedFirstTry'), endedAt: NOW }),
    );
    await act(async () => {
      await result.current.handleOutcome(phantom);
    });
    expect(result.current.current?.row).toBe(p1);
    expect(result.current.current?.context.presentationIndex).toBe(1);
    expect(result.current.status).toBe('solving');
  });

  it('exit stops advancing without completing the cycle', async () => {
    const p1 = puzzleFor('game:one', 6);
    const seed = await seedSession([p1]);
    const { recorder } = createRecorder();
    const { result } = renderSession(seed, recorder);
    await settle(result);

    act(() => result.current.exit());
    await act(async () => {
      await result.current.handleOutcome(
        await present(recorder, p1, seed.cycle.id, 1, 'solvedFirstTry'),
      );
    });
    // The outcome is ignored after exit; the cycle remains inProgress/resumable.
    expect(result.current.status).toBe('solving');
    expect((await trainingCyclesRepository.get(seed.cycle.id))?.status).toBe('inProgress');
  });
});
