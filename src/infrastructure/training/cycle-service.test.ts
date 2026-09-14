/**
 * CycleService tests (Feature 013, Stage C).
 *
 * Real Dexie over fake-indexeddb (shared test setup) with a deterministic
 * injected clock/id. Covers: start snapshot/numbering, reject-empty (no cycle),
 * reject invalid persisted config, resume after a simulated reload (no stored
 * cursor, idempotent), the bounded retry modes, completion, abandon, repeat,
 * results + same-set comparison, missing puzzle rows, write-failure
 * containment, the fixed block membership and the Quick-train sentinel session.
 * No engine, no network.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import {
  DEFAULT_CYCLE_CONFIG,
  QUICK_TRAIN_SET_ID,
  masteryOf,
  type CycleConfig,
  type PuzzleAttemptRow,
  type RetryFailed,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
  type TrainingResult,
} from '@/domain/training';
import {
  autoPoolRowFixture,
  blockSetFixture,
  cycleAttemptFixture,
  cycleFixture,
  legitimateFirstTryRows,
  setFixture,
} from '@/domain/training/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { PuzzleAttemptRecorder, PuzzleAttemptWriteError } from './attempts-service';
import { CycleService } from './cycle-service';

const NOW = 1_700_000_000_000;
let idCounter = 0;
const newId = (): string => `cycle:${(idCounter += 1)}`;

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

/** A game-scoped puzzle row (the base fixture with overridden provenance). */
function puzzleFor(gameId: string, ply: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: gameId, sourcePly: ply };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

function configWith(retryFailed: RetryFailed): CycleConfig {
  return { ...DEFAULT_CYCLE_CONFIG, retryFailed };
}

/** Persist the given puzzles and a set whose membership is exactly their ids. */
async function seedSet(
  puzzles: readonly PuzzleRow[],
  overrides: Partial<TacticalTrainingSetRow> = {},
): Promise<TacticalTrainingSetRow> {
  if (puzzles.length > 0) {
    await puzzlesRepository.addIfAbsent(puzzles);
  }
  const set = setFixture({
    id: 'set:one',
    puzzleIds: puzzles.map(idOf),
    ...overrides,
  });
  await trainingSetsRepository.create(set);
  return set;
}

function attempt(
  cycle: TrainingCycleRow,
  set: TacticalTrainingSetRow,
  puzzleId: string,
  presentationIndex: number,
  result: TrainingResult,
): PuzzleAttemptRow {
  return cycleAttemptFixture({
    cycleId: cycle.id,
    trainingSetId: set.id,
    puzzleId,
    presentationIndex,
    result,
  });
}

describe('CycleService', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
    await db.games.clear();
    idCounter = 0;
  });

  it('start snapshots membership/config and assigns the next 1-based cycle number', async () => {
    const set = await seedSet([puzzleFor('game:one', 6), puzzleFor('game:one', 10)]);

    const result = await makeService().start(set.id);

    if (!result.ok) throw new Error('expected start to succeed');
    expect(result.cycle.cycleNumber).toBe(1);
    expect(result.cycle.trainingSetId).toBe(set.id);
    expect(result.cycle.status).toBe('inProgress');
    expect(result.cycle.puzzleIds).toEqual(['game:one:6', 'game:one:10']);
    expect(result.cycle.startedAt).toBe(NOW);
    expect(result.cycle.completedAt).toBeNull();
    expect(result.cycle.abandonedAt).toBeNull();
    expect(result.missingPuzzleIds).toEqual([]);
    expect(await trainingCyclesRepository.get(result.cycle.id)).toEqual(result.cycle);
  });

  it('start resumes an existing in-progress cycle instead of creating a duplicate', async () => {
    const set = await seedSet([puzzleFor('game:one', 6)]);
    const service = makeService();

    const first = await service.start(set.id);
    if (!first.ok) throw new Error('expected start to succeed');
    const second = await service.start(set.id);

    if (!second.ok) throw new Error('expected second start to succeed');
    expect(second.cycle.id).toBe(first.cycle.id);
    expect(second.cycle.cycleNumber).toBe(1);
    expect(await trainingCyclesRepository.listForSet(set.id)).toHaveLength(1);
  });

  it('start abandons a stray duplicate in-progress cycle when resuming', async () => {
    const set = await seedSet([puzzleFor('game:one', 6)]);
    // Simulate a pre-`activeCycleOf` stray: two in-progress rows, the lower
    // number is the real pass (it has the attempt), the higher one shadows it.
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cyc:1', trainingSetId: set.id, cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cyc:2', trainingSetId: set.id, cycleNumber: 2 }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'cyc:1',
        trainingSetId: set.id,
        puzzleId: idOf(puzzleFor('game:one', 6)),
        presentationIndex: 0,
        result: 'solvedFirstTry',
      }),
    );

    const result = await makeService().start(set.id);

    if (!result.ok) throw new Error('expected start to succeed');
    expect(result.cycle.id).toBe('cyc:1');
    const rows = await trainingCyclesRepository.listForSet(set.id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('cyc:1')?.status).toBe('inProgress');
    expect(byId.get('cyc:2')?.status).toBe('abandoned');
    expect(byId.get('cyc:2')?.abandonedAt).toBe(NOW);
  });

  it('resume abandons a stray duplicate in-progress cycle of the same set', async () => {
    const set = await seedSet([puzzleFor('game:one', 6)]);
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cyc:1',
        trainingSetId: set.id,
        cycleNumber: 1,
        puzzleIds: [idOf(puzzleFor('game:one', 6))],
      }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cyc:2', trainingSetId: set.id, cycleNumber: 2 }),
    );

    const result = await makeService().resume('cyc:1');

    if (!result.ok) throw new Error('expected resume to succeed');
    expect(result.cycle.id).toBe('cyc:1');
    const rows = await trainingCyclesRepository.listForSet(set.id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('cyc:1')?.status).toBe('inProgress');
    expect(byId.get('cyc:2')?.status).toBe('abandoned');
  });

  it('reconcileInProgress abandons every in-progress cycle except the active one', async () => {
    const set = await seedSet([puzzleFor('game:one', 6)]);
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cyc:1', trainingSetId: set.id, cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cyc:2', trainingSetId: set.id, cycleNumber: 2 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cyc:done',
        trainingSetId: set.id,
        cycleNumber: 3,
        status: 'completed',
        completedAt: NOW,
      }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({
        cycleId: 'cyc:1',
        trainingSetId: set.id,
        puzzleId: idOf(puzzleFor('game:one', 6)),
        presentationIndex: 0,
        result: 'solvedFirstTry',
      }),
    );

    const abandoned = await makeService().reconcileInProgress(set.id);

    expect(abandoned).toBe(1);
    const rows = await trainingCyclesRepository.listForSet(set.id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('cyc:1')?.status).toBe('inProgress');
    expect(byId.get('cyc:2')?.status).toBe('abandoned');
    expect(byId.get('cyc:done')?.status).toBe('completed');
  });

  it('reconcileInProgress is a no-op with zero or one in-progress cycle', async () => {
    const set = await seedSet([puzzleFor('game:one', 6)]);
    expect(await makeService().reconcileInProgress(set.id)).toBe(0);

    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cyc:1', trainingSetId: set.id, cycleNumber: 1 }),
    );
    expect(await makeService().reconcileInProgress(set.id)).toBe(0);
    const rows = await trainingCyclesRepository.listForSet(set.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('inProgress');
  });

  it('start rejects an empty set (no puzzle row) and creates no cycle', async () => {
    const empty = await seedSet([]);
    expect(await makeService().start(empty.id)).toEqual({ ok: false, reason: 'empty-set' });
    expect(await trainingCyclesRepository.listForSet(empty.id)).toEqual([]);

    const removed = await seedSet([], { id: 'set:removed', puzzleIds: ['ghost:1'] });
    expect(await makeService().start(removed.id)).toEqual({ ok: false, reason: 'empty-set' });
  });

  it('start tracks missing snapshot ids but still starts when a puzzle row survives', async () => {
    const present = puzzleFor('game:one', 6);
    const set = await seedSet([present], { puzzleIds: [idOf(present), 'game:gone:2'] });

    const result = await makeService().start(set.id);

    if (!result.ok) throw new Error('expected start to succeed');
    expect(result.cycle.puzzleIds).toEqual([idOf(present), 'game:gone:2']);
    expect(result.missingPuzzleIds).toEqual(['game:gone:2']);
  });

  it('start rejects a missing set and an invalid persisted config', async () => {
    expect(await makeService().start('missing')).toEqual({ ok: false, reason: 'not-found' });

    const badConfig = { ...DEFAULT_CYCLE_CONFIG, ordering: 'bogus' } as unknown as CycleConfig;
    const set = await seedSet([], { id: 'set:bad', config: badConfig });
    const result = await makeService().start(set.id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('invalid-config');
  });

  it("start snapshots a block's fixed stored membership without re-deriving it", async () => {
    const stored = autoPoolRowFixture(1, 10);
    await puzzlesRepository.addIfAbsent([stored]);
    const block = blockSetFixture({ id: 'block:one', puzzleIds: [idOf(stored)] });
    await trainingSetsRepository.create(block);
    // A newly generated puzzle joins the pool, never the frozen block.
    await puzzlesRepository.addIfAbsent([autoPoolRowFixture(2, 5)]);

    const result = await makeService().start(block.id);

    if (!result.ok) throw new Error('expected start to succeed');
    expect(result.cycle.puzzleIds).toEqual([idOf(stored)]);
    expect(result.missingPuzzleIds).toEqual([]);
    expect((await trainingSetsRepository.get(block.id))?.puzzleIds).toEqual([idOf(stored)]);
  });

  it('resume after reload reconstructs the same pending queue with no stored cursor', async () => {
    const [p1, p2, p3] = [
      puzzleFor('game:one', 6),
      puzzleFor('game:one', 8),
      puzzleFor('game:one', 10),
    ];
    const set = await seedSet([p1, p2, p3]);
    const started = await makeService().start(set.id);
    if (!started.ok) throw new Error('expected start to succeed');
    const cycle = started.cycle;
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p1), 1, 'solvedFirstTry'));

    // A fresh service instance simulates a reload: state comes from persisted rows.
    const resumed = await makeService().resume(cycle.id);
    if (!resumed.ok) throw new Error('expected resume to succeed');
    expect(resumed.complete).toBe(false);
    expect(resumed.queue).toEqual([
      { puzzleId: idOf(p2), presentationIndex: 1 },
      { puzzleId: idOf(p3), presentationIndex: 1 },
    ]);

    const again = await makeService().resume(cycle.id);
    if (!again.ok) throw new Error('expected resume to succeed');
    expect(again.queue).toEqual(resumed.queue);
  });

  it('resume completes the cycle when nothing is pending and refuses terminal cycles', async () => {
    const [p1, p2] = [puzzleFor('game:one', 6), puzzleFor('game:one', 8)];
    const set = await seedSet([p1, p2]);
    const service = makeService();
    const started = await service.start(set.id);
    if (!started.ok) throw new Error('expected start to succeed');
    const cycle = started.cycle;
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p1), 1, 'solvedFirstTry'));
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p2), 1, 'solvedFirstTry'));

    const completed = await service.resume(cycle.id);
    if (!completed.ok) throw new Error('expected resume to succeed');
    expect(completed.complete).toBe(true);
    expect(completed.queue).toEqual([]);
    const stored = await trainingCyclesRepository.get(cycle.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.completedAt).toBe(NOW);

    const refused = await service.resume(cycle.id);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected refusal');
    if (refused.reason !== 'not-resumable') throw new Error('expected not-resumable');
    expect(refused.status).toBe('completed');

    const cannotAbandon = await service.abandon(cycle.id);
    expect(cannotAbandon.ok).toBe(false);
    if (cannotAbandon.ok) throw new Error('expected refusal');
    expect(cannotAbandon.reason).toBe('not-abandonable');
  });

  it('resume enqueues bounded retries in the configured order (immediate / endOfCycle / none)', async () => {
    const [p1, p2, p3] = [
      puzzleFor('game:one', 6),
      puzzleFor('game:one', 8),
      puzzleFor('game:one', 10),
    ];

    async function queueFor(retryFailed: RetryFailed): Promise<readonly string[]> {
      const set = await seedSet([p1, p2, p3], {
        id: `set:${retryFailed}`,
        config: configWith(retryFailed),
      });
      const started = await makeService().start(set.id);
      if (!started.ok) throw new Error('expected start to succeed');
      await attemptsRepository.addAttempt(attempt(started.cycle, set, idOf(p2), 1, 'failed'));
      const resumed = await makeService().resume(started.cycle.id);
      if (!resumed.ok) throw new Error('expected resume to succeed');
      return resumed.queue.map((entry) => `${entry.puzzleId}@${entry.presentationIndex}`);
    }

    expect(await queueFor('immediate')).toEqual([
      `${idOf(p2)}@2`,
      `${idOf(p1)}@1`,
      `${idOf(p3)}@1`,
    ]);
    expect(await queueFor('endOfCycle')).toEqual([
      `${idOf(p1)}@1`,
      `${idOf(p3)}@1`,
      `${idOf(p2)}@2`,
    ]);
    expect(await queueFor('none')).toEqual([`${idOf(p1)}@1`, `${idOf(p3)}@1`]);
  });

  it('a re-failed retry is terminal (max two presentations)', async () => {
    const [p1, p2] = [puzzleFor('game:one', 6), puzzleFor('game:one', 8)];
    const set = await seedSet([p1, p2], { config: configWith('endOfCycle') });
    const started = await makeService().start(set.id);
    if (!started.ok) throw new Error('expected start to succeed');
    const cycle = started.cycle;
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p1), 1, 'solvedFirstTry'));
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p2), 1, 'failed'));
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p2), 2, 'failed'));

    const resumed = await makeService().resume(cycle.id);
    if (!resumed.ok) throw new Error('expected resume to succeed');
    expect(resumed.complete).toBe(true);
    expect(resumed.queue).toEqual([]);
  });

  it('abandon keeps attempts, is terminal and is never resumable', async () => {
    const [p1] = [puzzleFor('game:one', 6)];
    const set = await seedSet([p1]);
    const service = makeService();
    const started = await service.start(set.id);
    if (!started.ok) throw new Error('expected start to succeed');
    const cycle = started.cycle;
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p1), 1, 'solvedFirstTry'));

    const abandoned = await service.abandon(cycle.id);
    if (!abandoned.ok) throw new Error('expected abandon to succeed');
    expect(abandoned.cycle.status).toBe('abandoned');
    expect(abandoned.cycle.abandonedAt).toBe(NOW);
    expect(await attemptsRepository.listForCycle(cycle.id)).toHaveLength(1);

    const resumed = await service.resume(cycle.id);
    expect(resumed.ok).toBe(false);
    if (resumed.ok) throw new Error('expected refusal');
    if (resumed.reason !== 'not-resumable') throw new Error('expected not-resumable');
    expect(resumed.status).toBe('abandoned');

    // Idempotent abandon returns the same terminal cycle.
    const again = await service.abandon(cycle.id);
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('expected idempotent abandon');
    expect(again.cycle).toEqual(abandoned.cycle);
  });

  it('repeat starts a new cycle over the current set with the next number and a fresh snapshot', async () => {
    const [p1, p2] = [puzzleFor('game:one', 6), puzzleFor('game:one', 8)];
    const set = await seedSet([p1, p2]);
    const service = makeService();
    const first = await service.start(set.id);
    if (!first.ok) throw new Error('expected start to succeed');
    await attemptsRepository.addAttempt(attempt(first.cycle, set, idOf(p1), 1, 'solvedFirstTry'));
    await attemptsRepository.addAttempt(attempt(first.cycle, set, idOf(p2), 1, 'solvedFirstTry'));
    const completed = await service.resume(first.cycle.id);
    if (!completed.ok || !completed.complete) throw new Error('expected first cycle to complete');

    const second = await service.repeat(set.id);
    if (!second.ok) throw new Error('expected repeat to succeed');
    expect(second.cycle.cycleNumber).toBe(2);
    expect(second.cycle.id).not.toBe(first.cycle.id);
    expect(second.cycle.status).toBe('inProgress');
    expect(second.cycle.puzzleIds).toEqual(first.cycle.puzzleIds);
    expect((await service.listForSet(set.id)).map((cycle) => cycle.cycleNumber)).toEqual([1, 2]);
  });

  it('results returns per-puzzle resolutions, canonical aggregates and the previous-cycle input', async () => {
    const [p1, p2, p3] = [
      puzzleFor('game:one', 6),
      puzzleFor('game:one', 8),
      puzzleFor('game:one', 10),
    ];
    const set = await seedSet([p1, p2, p3]);
    const service = makeService();
    const first = await service.start(set.id);
    if (!first.ok) throw new Error('expected start to succeed');
    const cycle = first.cycle;
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p1), 1, 'solvedFirstTry'));
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p2), 1, 'failed'));
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p2), 2, 'solvedWithHelp'));
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p3), 1, 'skipped'));

    const results = await service.results(cycle.id);
    if (!results.ok) throw new Error('expected results to succeed');
    expect(results.results.resolutions).toHaveLength(3);
    expect(results.results.previous).toBeNull();
    expect(results.results.metrics).toMatchObject({
      puzzlesAttempted: 3,
      puzzlesCompleted: 2,
      puzzlesSkipped: 1,
      firstTryAccuracy: 0.5,
      solveRate: 1,
      totalPresentations: 4,
      totalWrongMoves: 1,
      hintsUsed: 1,
      puzzlesRequiringHint: 1,
      retries: 1,
      puzzlesRequiringRetry: 1,
      sampleUnit: 'puzzles',
    });
    expect(results.results.metrics.solvingTime).toEqual({
      totalMs: 15_000,
      averageMs: 7_500,
      medianMs: 7_500,
    });

    const completed = await service.resume(cycle.id);
    if (!completed.ok || !completed.complete) throw new Error('expected cycle to complete');
    const second = await service.repeat(set.id);
    if (!second.ok) throw new Error('expected repeat to succeed');
    await attemptsRepository.addAttempt(attempt(second.cycle, set, idOf(p1), 1, 'solvedFirstTry'));

    const secondResults = await service.results(second.cycle.id);
    if (!secondResults.ok) throw new Error('expected results to succeed');
    expect(secondResults.results.previous?.cycle.cycleNumber).toBe(1);
    expect(secondResults.results.previous?.metrics.puzzlesCompleted).toBe(2);
  });

  it('results excludes a missing snapshot puzzle and lists it explicitly', async () => {
    const [p1, p2] = [puzzleFor('game:one', 6), puzzleFor('game:one', 8)];
    const set = await seedSet([p1, p2]);
    const service = makeService();
    const started = await service.start(set.id);
    if (!started.ok) throw new Error('expected start to succeed');
    const cycle = started.cycle;
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p1), 1, 'solvedFirstTry'));
    await db.puzzles.delete([p2.sourceGameId, p2.sourcePly]);

    const results = await service.results(cycle.id);
    if (!results.ok) throw new Error('expected results to succeed');
    expect(results.results.missingPuzzleIds).toEqual([idOf(p2)]);
    expect(results.results.metrics.puzzlesAttempted).toBe(1);
    expect(results.results.metrics.puzzlesCompleted).toBe(1);
  });

  it('a failed attempt write leaves the cycle inProgress and resumable (write-failure containment)', async () => {
    const [p1] = [puzzleFor('game:one', 6)];
    const set = await seedSet([p1]);
    const service = makeService();
    const started = await service.start(set.id);
    if (!started.ok) throw new Error('expected start to succeed');
    const cycle = started.cycle;

    const failing: PuzzleAttemptsRepository = {
      addAttempt: () => Promise.reject(new Error('simulated write failure')),
      getAttempt: () => Promise.resolve(undefined),
      listForCycle: (id) => attemptsRepository.listForCycle(id),
      listForPuzzle: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      listForCycleAndPuzzle: () => Promise.resolve([]),
      deleteForPuzzleIds: () => Promise.resolve(),
      deleteForTrainingSetIds: () => Promise.resolve(),
    };
    const recorder = new PuzzleAttemptRecorder({ attempts: failing, now: () => NOW });
    await expect(
      recorder.record({
        row: p1,
        context: { trainingSetId: set.id, cycleId: cycle.id, presentationIndex: 1 },
        trigger: 'solved',
        counters: { wrongMoveCount: 0, hintCount: 0, highestHintLevel: null },
        startedAt: NOW - 5_000,
      }),
    ).rejects.toThrow(PuzzleAttemptWriteError);
    expect(await attemptsRepository.listForCycle(cycle.id)).toEqual([]);

    // The unwritten puzzle is still pending: the cycle must not be marked complete.
    const pending = await service.resume(cycle.id);
    if (!pending.ok) throw new Error('expected resume to succeed');
    expect(pending.complete).toBe(false);
    expect(pending.queue).toEqual([{ puzzleId: idOf(p1), presentationIndex: 1 }]);
    expect((await trainingCyclesRepository.get(cycle.id))?.status).toBe('inProgress');

    // Once the row is durably written, the cycle completes.
    await attemptsRepository.addAttempt(attempt(cycle, set, idOf(p1), 1, 'solvedFirstTry'));
    const done = await service.resume(cycle.id);
    if (!done.ok) throw new Error('expected resume to succeed');
    expect(done.complete).toBe(true);
    expect((await trainingCyclesRepository.get(cycle.id))?.status).toBe('completed');
  });

  it('rejects an invalid persisted config on resume and results without coercing it', async () => {
    const badConfig = { ...DEFAULT_CYCLE_CONFIG, ordering: 'bogus' } as unknown as CycleConfig;
    await trainingCyclesRepository.create(cycleAttemptSeedCycle({ config: badConfig }));

    const service = makeService();
    const resumed = await service.resume('cycle:bad');
    expect(resumed.ok).toBe(false);
    if (resumed.ok) throw new Error('expected rejection');
    expect(resumed.reason).toBe('invalid-config');

    const results = await service.results('cycle:bad');
    expect(results.ok).toBe(false);
    if (results.ok) throw new Error('expected rejection');
    expect(results.reason).toBe('invalid-config');
  });

  it('startQuickTrain snapshots the pool under the sentinel and creates no set row', async () => {
    await puzzlesRepository.addIfAbsent([
      autoPoolRowFixture(1, 50),
      autoPoolRowFixture(2, 10),
      autoPoolRowFixture(3, 30),
    ]);

    const result = await makeService().startQuickTrain();

    if (!result.ok) throw new Error('expected quick train to succeed');
    expect(result.cycle.trainingSetId).toBe(QUICK_TRAIN_SET_ID);
    expect(result.cycle.cycleNumber).toBe(1);
    expect(result.cycle.status).toBe('inProgress');
    expect(result.cycle.startedAt).toBe(NOW);
    expect(result.cycle.puzzleIds).toEqual([
      'fixture:auto-2:2',
      'fixture:auto-3:3',
      'fixture:auto-1:1',
    ]);
    expect(result.missingPuzzleIds).toEqual([]);
    expect(await trainingSetsRepository.get(QUICK_TRAIN_SET_ID)).toBeUndefined();
    expect(await trainingSetsRepository.list()).toEqual([]);
    expect(await trainingCyclesRepository.get(result.cycle.id)).toEqual(result.cycle);
  });

  it('startQuickTrain excludes mastered puzzles and the open block members', async () => {
    const pool = [autoPoolRowFixture(1, 10), autoPoolRowFixture(2, 20), autoPoolRowFixture(3, 30)];
    await puzzlesRepository.addIfAbsent(pool);
    const masteredCycleIds = ['c1', 'c2', 'c3'];
    for (const [index, cycleId] of masteredCycleIds.entries()) {
      await trainingCyclesRepository.create(
        cycleFixture({ id: cycleId, cycleNumber: index + 1, puzzleIds: [idOf(pool[0]!)] }),
      );
    }
    for (const row of legitimateFirstTryRows(idOf(pool[0]!), masteredCycleIds)) {
      await attemptsRepository.addAttempt(row);
    }
    await trainingSetsRepository.create(
      blockSetFixture({ id: 'block:one', puzzleIds: [idOf(pool[1]!)] }),
    );

    const result = await makeService().startQuickTrain();

    if (!result.ok) throw new Error('expected quick train to succeed');
    expect(result.cycle.puzzleIds).toEqual([idOf(pool[2]!)]);
  });

  it('startQuickTrain resumes the latest in-progress sentinel cycle without creating a row', async () => {
    await puzzlesRepository.addIfAbsent([autoPoolRowFixture(1, 10)]);
    const service = makeService();
    const first = await service.startQuickTrain();
    const second = await service.startQuickTrain();
    if (!first.ok || !second.ok) throw new Error('expected quick trains to succeed');
    expect(second.cycle.id).toBe(first.cycle.id);
    expect(second.cycle.cycleNumber).toBe(1);
    expect(await trainingCyclesRepository.listForSet(QUICK_TRAIN_SET_ID)).toHaveLength(1);
  });

  it.each(['completed', 'abandoned'] as const)(
    'startQuickTrain creates a new sentinel cycle once the previous one is %s',
    async (status) => {
      await puzzlesRepository.addIfAbsent([autoPoolRowFixture(1, 10)]);
      const service = makeService();
      const first = await service.startQuickTrain();
      if (!first.ok) throw new Error('expected quick train to succeed');
      await trainingCyclesRepository.updateStatus(first.cycle.id, {
        status,
        ...(status === 'completed' ? { completedAt: NOW } : { abandonedAt: NOW }),
      });

      const second = await service.startQuickTrain();

      if (!second.ok) throw new Error('expected quick train to succeed');
      expect(second.cycle.id).not.toBe(first.cycle.id);
      expect(second.cycle.cycleNumber).toBe(2);
      expect(await trainingCyclesRepository.listForSet(QUICK_TRAIN_SET_ID)).toHaveLength(2);
    },
  );

  it('startQuickTrain abandons stray extra in-progress sentinel cycles when resuming', async () => {
    await puzzlesRepository.addIfAbsent([autoPoolRowFixture(1, 10)]);
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'qt:1', trainingSetId: QUICK_TRAIN_SET_ID, cycleNumber: 1 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'qt:2', trainingSetId: QUICK_TRAIN_SET_ID, cycleNumber: 2 }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'qt:done',
        trainingSetId: QUICK_TRAIN_SET_ID,
        cycleNumber: 3,
        status: 'completed',
        completedAt: NOW,
      }),
    );

    const result = await makeService().startQuickTrain();

    if (!result.ok) throw new Error('expected quick train to succeed');
    expect(result.cycle.id).toBe('qt:2');
    const rows = await trainingCyclesRepository.listForSet(QUICK_TRAIN_SET_ID);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(rows).toHaveLength(3);
    expect(byId.get('qt:1')?.status).toBe('abandoned');
    expect(byId.get('qt:1')?.abandonedAt).toBe(NOW);
    expect(byId.get('qt:2')?.status).toBe('inProgress');
    expect(byId.get('qt:done')?.status).toBe('completed');
  });

  it('startQuickTrain rejects an empty pool and creates no cycle', async () => {
    expect(await makeService().startQuickTrain()).toEqual({ ok: false, reason: 'empty-pool' });
    expect(await trainingCyclesRepository.listForSet(QUICK_TRAIN_SET_ID)).toEqual([]);
  });

  it('Quick-train attempts are ordinary but do not count toward mastery', async () => {
    await puzzlesRepository.addIfAbsent([autoPoolRowFixture(1, 10)]);
    const service = makeService();
    const puzzleId = 'fixture:auto-1:1';
    // Three distinct sentinel cycles (each completed before the next starts).
    for (let index = 0; index < 3; index += 1) {
      const started = await service.startQuickTrain();
      if (!started.ok) throw new Error('expected quick train to succeed');
      await attemptsRepository.addAttempt(
        cycleAttemptFixture({
          cycleId: started.cycle.id,
          trainingSetId: QUICK_TRAIN_SET_ID,
          puzzleId,
          presentationIndex: 1,
          result: 'solvedFirstTry',
        }),
      );
      await trainingCyclesRepository.updateStatus(started.cycle.id, {
        status: 'completed',
        completedAt: NOW,
      });
    }
    const cycles = await trainingCyclesRepository.listAll();
    expect(cycles).toHaveLength(3);
    expect(masteryOf(puzzleId, await attemptsRepository.listAll(), cycles)).toBe(false);
  });
});

/** A minimal invalid-config cycle fixture for the read-rejection cases. */
function cycleAttemptSeedCycle(overrides: { readonly config: CycleConfig }): TrainingCycleRow {
  return {
    id: 'cycle:bad',
    trainingSetId: 'set:one',
    cycleNumber: 1,
    status: 'inProgress',
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    abandonedAt: null,
    puzzleIds: [],
    config: overrides.config,
    cycleMetricsVersion: 1,
  };
}
