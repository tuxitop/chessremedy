/**
 * TrainingSetsService tests (Feature 013, Stage C).
 *
 * Real Dexie over fake-indexeddb (shared test setup), with a deterministic
 * injected clock/id. Covers: create from a game and from the pool (platform /
 * time-control filters), a zero-resolution empty set (explicit flag, still
 * persisted), manual selection order with missing ids dropped, the typed
 * rename/config/archive/unarchive/delete lifecycle, and the block model — the
 * derived pool, one-click Woodpecker block formation/refusals and the
 * close/return-to-pool lifecycle. No engine, no network.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { PuzzleRow } from '@/domain/puzzle/types';
import {
  DEFAULT_CYCLE_CONFIG,
  WOODPECKER_PLAN_CYCLES,
  type TacticalTrainingSetRow,
} from '@/domain/training';
import { cycleFixture, legitimateFirstTryRows } from '@/domain/training/test-support';
import { TrainingSetsService } from './training-sets-service';

const NOW = 1_700_000_000_000;
let idCounter = 0;
const newId = (): string => `set:${(idCounter += 1)}`;

function makeService(): TrainingSetsService {
  return new TrainingSetsService({
    sets: trainingSetsRepository,
    puzzles: puzzlesRepository,
    games: gamesRepository,
    attempts: attemptsRepository,
    cycles: trainingCyclesRepository,
    now: () => NOW,
    newId,
  });
}

/** A game-scoped puzzle row (the base fixture with overridden provenance). */
function gamePuzzle(gameId: string, ply: number, overrides: Partial<PuzzleRow> = {}): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: gameId, sourcePly: ply, ...overrides };
}

/** A synthetic pool row with overridable difficulty (provenance is deterministic). */
function poolPuzzle(index: number, difficulty: number): PuzzleRow {
  return gamePuzzle(`game:pool-${index}`, index, { difficulty });
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

/** Persist three clean first-try rows (three distinct cycles) for one puzzle. */
async function masterPuzzle(puzzleId: string): Promise<void> {
  const cycleIds = ['cycle:1', 'cycle:2', 'cycle:3'];
  for (const [index, cycleId] of cycleIds.entries()) {
    await trainingCyclesRepository.create(
      cycleFixture({ id: cycleId, cycleNumber: index + 1, puzzleIds: [puzzleId] }),
    );
  }
  for (const row of legitimateFirstTryRows(puzzleId, cycleIds)) {
    await attemptsRepository.addAttempt(row);
  }
}

/** Create a block and return its persisted row (fails the test when refused). */
async function createBlock(
  service: TrainingSetsService,
  size: number,
): Promise<TacticalTrainingSetRow> {
  const result = await service.createWoodpeckerBlock({ size });
  if (!result.ok) throw new Error(`expected block create to succeed (got ${result.reason})`);
  return result.set;
}

describe('TrainingSetsService', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
    await db.games.clear();
    await db.settings.clear();
    idCounter = 0;
  });

  it('creates a set from a game, storing the resolved membership in difficulty order', async () => {
    const hard = gamePuzzle('game:one', 10, { difficulty: 50 });
    const easy = gamePuzzle('game:one', 6, { difficulty: 12 });
    await puzzlesRepository.addIfAbsent([hard, easy]);

    const result = await makeService().createFromGame({
      gameId: 'game:one',
      name: 'Game one',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });

    if (!result.ok) throw new Error('expected create to succeed');
    expect(result.resolvedCount).toBe(2);
    expect(result.empty).toBe(false);
    expect(result.set.puzzleIds).toEqual(['game:one:6', 'game:one:10']);
    expect(result.set.source).toEqual({ kind: 'game', gameId: 'game:one' });
    expect(result.set.status).toBe('active');
    expect(result.set.createdAt).toBe(NOW);
    expect(result.set.updatedAt).toBe(NOW);
    expect(result.set.config.ordering).toBe('difficultyAsc');
    expect(await trainingSetsRepository.get(result.set.id)).toEqual(result.set);
  });

  it('applies origin and difficulty filters when creating from a game', async () => {
    await puzzlesRepository.addIfAbsent([
      gamePuzzle('game:two', 6, { origin: 'tactical', difficulty: 12 }),
      gamePuzzle('game:two', 8, { origin: 'blunder', difficulty: 60 }),
    ]);

    const result = await makeService().createFromGame({
      gameId: 'game:two',
      name: 'Blunders',
      ordering: 'sourcePly',
      targetSize: 10,
      originFilter: 'blunder',
    });

    if (!result.ok) throw new Error('expected create to succeed');
    expect(result.set.puzzleIds).toEqual(['game:two:8']);
  });

  it('creates a set from the pool filtered by platform and time-control category', async () => {
    const cc = fixtureGame('cc-blitz-clean');
    const li = fixtureGame('li-rapid-clean');
    await gamesRepository.saveGame(cc);
    await gamesRepository.saveGame(li);
    await puzzlesRepository.addIfAbsent([gamePuzzle(cc.id, 6), gamePuzzle(li.id, 6)]);

    const byPlatform = await makeService().createFromPool({
      filters: { platform: 'chesscom' },
      name: 'Chess.com',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!byPlatform.ok) throw new Error('expected pool create to succeed');
    expect(byPlatform.set.puzzleIds).toEqual([puzzleIdOf(cc.id, 6)]);
    expect(byPlatform.set.source).toEqual({ kind: 'pool', filters: { platform: 'chesscom' } });

    const byTimeControl = await makeService().createFromPool({
      filters: { timeControlCategory: 'rapid' },
      name: 'Rapid',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!byTimeControl.ok) throw new Error('expected pool create to succeed');
    expect(byTimeControl.set.puzzleIds).toEqual([puzzleIdOf(li.id, 6)]);
  });

  it('persists an explicit empty set when the source resolves nothing (never a fake count)', async () => {
    const result = await makeService().createFromGame({
      gameId: 'game:empty',
      name: 'Empty',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });

    if (!result.ok) throw new Error('expected create to succeed');
    expect(result.resolvedCount).toBe(0);
    expect(result.empty).toBe(true);
    expect(result.set.puzzleIds).toEqual([]);
    expect(await trainingSetsRepository.get(result.set.id)).toEqual(result.set);
  });

  it('creates a manual set preserving selection order and dropping missing ids', async () => {
    await puzzlesRepository.addIfAbsent([
      gamePuzzle('game:three', 6),
      gamePuzzle('game:three', 10),
    ]);

    const result = await makeService().createManual({
      puzzleIds: ['game:three:10', 'ghost:1', 'game:three:6'],
      name: 'Manual',
      ordering: 'manual',
      targetSize: 10,
    });

    if (!result.ok) throw new Error('expected create to succeed');
    expect(result.set.puzzleIds).toEqual(['game:three:10', 'game:three:6']);
    expect(result.set.source).toEqual({ kind: 'manual' });
  });

  it('renames, reconfigures, archives, unarchives and deletes with typed results', async () => {
    const service = makeService();
    const created = await service.createFromGame({
      gameId: 'game:four',
      name: 'Before',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!created.ok) throw new Error('expected create to succeed');
    const id = created.set.id;

    const renamed = await service.rename(id, 'After');
    if (!renamed.ok) throw new Error('expected rename to succeed');
    expect(renamed.set.name).toBe('After');

    const configured = await service.updateConfig(id, {
      ordering: 'sourcePly',
      retryFailed: 'none',
      hints: { enabledLevels: [2, 3], firstHintLevel: 2 },
      allowSkip: false,
      targetAccuracy: 0.9,
      targetSolvingTimeMs: null,
      plannedCycles: 5,
      configVersion: 1,
    });
    if (!configured.ok) throw new Error('expected updateConfig to succeed');
    expect(configured.set.config.ordering).toBe('sourcePly');
    expect(configured.set.config.allowSkip).toBe(false);

    const archived = await service.archive(id);
    if (!archived.ok) throw new Error('expected archive to succeed');
    expect(archived.set.status).toBe('archived');
    expect((await service.list()).map((set) => set.id)).not.toContain(id);
    expect((await service.list({ status: 'archived' })).map((set) => set.id)).toContain(id);

    const unarchived = await service.unarchive(id);
    if (!unarchived.ok) throw new Error('expected unarchive to succeed');
    expect(unarchived.set.status).toBe('active');

    expect(await service.delete(id)).toEqual({ ok: true });
    expect(await trainingSetsRepository.get(id)).toBeUndefined();
    expect(await service.delete(id)).toEqual({ ok: false, reason: 'not-found' });
    expect(await service.rename('missing', 'x')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('rejects an invalid config on update without persisting it', async () => {
    const service = makeService();
    const created = await service.createFromGame({
      gameId: 'game:five',
      name: 'Keep',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!created.ok) throw new Error('expected create to succeed');

    const result = await service.updateConfig(created.set.id, { ordering: 'bogus' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('invalid-config');

    const stored = await trainingSetsRepository.get(created.set.id);
    expect(stored?.config).toEqual(created.set.config);
  });

  it('derives the pool from owned puzzles minus mastered and the open block members', async () => {
    const service = makeService();
    const pool = [poolPuzzle(1, 10), poolPuzzle(2, 20), poolPuzzle(3, 30)];
    await puzzlesRepository.addIfAbsent(pool);
    await masterPuzzle(idOf(pool[0]!));

    expect((await service.listPool()).map(idOf)).toEqual([idOf(pool[1]!), idOf(pool[2]!)]);

    await trainingSetsRepository.create({
      id: 'block:one',
      name: 'Woodpecker block',
      createdAt: NOW,
      updatedAt: NOW,
      status: 'active',
      source: { kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: 200 } },
      puzzleIds: [idOf(pool[1]!)],
      targetSize: 200,
      config: DEFAULT_CYCLE_CONFIG,
    });

    expect((await service.listPool()).map(idOf)).toEqual([idOf(pool[2]!)]);
    expect(await service.getOpenBlock()).toMatchObject({ id: 'block:one' });
  });

  it('creates a one-click Woodpecker block as the easiest-N pool snapshot', async () => {
    const service = makeService();
    const pool = [poolPuzzle(1, 50), poolPuzzle(2, 10), poolPuzzle(3, 30), poolPuzzle(4, 20)];
    await puzzlesRepository.addIfAbsent(pool);
    await masterPuzzle(idOf(pool[0]!));

    const result = await service.createWoodpeckerBlock({ size: 2 });

    if (!result.ok) throw new Error('expected block create to succeed');
    expect(result.selectedCount).toBe(2);
    expect(result.set.puzzleIds).toEqual([idOf(pool[1]!), idOf(pool[3]!)]);
    expect(result.set.status).toBe('active');
    expect(result.set.source).toEqual({
      kind: 'auto',
      recipe: { kind: 'woodpeckerBlock', size: 2 },
    });
    expect(result.set.targetSize).toBe(2);
    expect(result.set.name).toBe('Woodpecker block');
    expect(result.set.config).toEqual({
      ...DEFAULT_CYCLE_CONFIG,
      ordering: 'difficultyAsc',
      retryFailed: 'endOfCycle',
      allowSkip: true,
      targetAccuracy: null,
      targetSolvingTimeMs: null,
      plannedCycles: WOODPECKER_PLAN_CYCLES,
    });
    expect(await service.getOpenBlock()).toEqual(result.set);
  });

  it('takes all of the pool when it is smaller than the requested size', async () => {
    const service = makeService();
    await puzzlesRepository.addIfAbsent([poolPuzzle(1, 30), poolPuzzle(2, 10)]);

    const result = await service.createWoodpeckerBlock({ size: 400 });

    if (!result.ok) throw new Error('expected block create to succeed');
    expect(result.selectedCount).toBe(2);
    expect(result.set.puzzleIds).toEqual([idOf(poolPuzzle(2, 10)), idOf(poolPuzzle(1, 30))]);
  });

  it('freezes the block membership: a later puzzle joins the pool, not the block', async () => {
    const service = makeService();
    await puzzlesRepository.addIfAbsent([poolPuzzle(1, 10)]);
    const block = await createBlock(service, 200);
    await puzzlesRepository.addIfAbsent([poolPuzzle(2, 5)]);

    expect((await service.getOpenBlock())?.puzzleIds).toEqual(block.puzzleIds);
    expect((await service.listPool()).map(idOf)).toEqual([idOf(poolPuzzle(2, 5))]);
  });

  it('refuses a second block while one is open and an empty pool', async () => {
    const service = makeService();
    await puzzlesRepository.addIfAbsent([poolPuzzle(1, 10)]);
    const block = await createBlock(service, 200);

    const second = await service.createWoodpeckerBlock({ size: 200 });
    expect(second).toEqual({ ok: false, reason: 'block-open', block });

    await service.closeBlock(block.id);
    await db.puzzles.clear();
    expect(await service.createWoodpeckerBlock({ size: 200 })).toEqual({
      ok: false,
      reason: 'empty-pool',
    });
  });

  it('closeBlock archives the block and returns its unmastered members to the pool', async () => {
    const service = makeService();
    const pool = [poolPuzzle(1, 10), poolPuzzle(2, 20), poolPuzzle(3, 30)];
    await puzzlesRepository.addIfAbsent(pool);
    const block = await createBlock(service, 2);
    await masterPuzzle(block.puzzleIds[0]!);

    expect((await service.listPool()).map(idOf)).toEqual([idOf(pool[2]!)]);

    const closed = await service.closeBlock(block.id);
    if (!closed.ok) throw new Error('expected close to succeed');
    expect(closed.set.status).toBe('archived');
    expect(closed.set.updatedAt).toBe(NOW);
    expect(await service.getOpenBlock()).toBeUndefined();
    // Unmastered members return; the mastered member stays outside the pool.
    expect((await service.listPool()).map(idOf)).toEqual([idOf(pool[1]!), idOf(pool[2]!)]);

    // Idempotent, and a non-block / missing id is a typed refusal.
    expect(await service.closeBlock(block.id)).toEqual({ ok: true, set: closed.set });
    expect(await service.closeBlock('missing')).toEqual({ ok: false, reason: 'not-found' });

    const custom = await service.createFromGame({
      gameId: 'game:custom',
      name: 'Custom',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!custom.ok) throw new Error('expected custom create to succeed');
    expect(await service.closeBlock(custom.set.id)).toEqual({ ok: false, reason: 'not-a-block' });
  });

  it('closeBlock abandons an in-progress cycle of that block', async () => {
    const service = makeService();
    await puzzlesRepository.addIfAbsent([poolPuzzle(1, 10)]);
    const block = await createBlock(service, 200);
    const cycle = cycleFixture({
      id: 'cycle:open',
      trainingSetId: block.id,
      cycleNumber: 1,
      status: 'inProgress',
      startedAt: NOW - 60_000,
      puzzleIds: block.puzzleIds,
    });
    await trainingCyclesRepository.create(cycle);

    const closed = await service.closeBlock(block.id);
    if (!closed.ok) throw new Error('expected close to succeed');

    const stored = await trainingCyclesRepository.get(cycle.id);
    expect(stored?.status).toBe('abandoned');
    expect(stored?.abandonedAt).toBe(NOW);
    expect(stored?.completedAt).toBeNull();
  });

  it('refuses every mutation of a Woodpecker block except closeBlock', async () => {
    const service = makeService();
    await puzzlesRepository.addIfAbsent([poolPuzzle(1, 10)]);
    const block = await createBlock(service, 200);

    expect(await service.rename(block.id, 'Nope')).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.updateConfig(block.id, DEFAULT_CYCLE_CONFIG)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.archive(block.id)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.unarchive(block.id)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.delete(block.id)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });

    const stored = await service.getOpenBlock();
    expect(stored?.id).toBe(block.id);
    expect(stored?.status).toBe('active');
  });

  it('seeds a new set and block from the stored global hint default', async () => {
    await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, {
      enabledLevels: [2, 4],
      firstHintLevel: 4,
    });
    const service = makeService();

    const created = await service.createFromGame({
      gameId: 'game:hints',
      name: 'Hints',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!created.ok) throw new Error('expected create to succeed');
    expect(created.set.config.hints).toEqual({ enabledLevels: [2, 4], firstHintLevel: 4 });
    // All other fields keep the existing defaults.
    expect(created.set.config.ordering).toBe('difficultyAsc');
    expect(created.set.config.retryFailed).toBe(DEFAULT_CYCLE_CONFIG.retryFailed);
    expect(created.set.config.allowSkip).toBe(true);
    expect(created.set.config.targetAccuracy).toBeNull();

    await puzzlesRepository.addIfAbsent([poolPuzzle(1, 10)]);
    const block = await createBlock(service, 200);
    expect(block.config.hints).toEqual({ enabledLevels: [2, 4], firstHintLevel: 4 });
    expect(block.config.plannedCycles).toBe(WOODPECKER_PLAN_CYCLES);
  });

  it('falls back to the hardcoded hints when the stored default is unset', async () => {
    const created = await makeService().createFromGame({
      gameId: 'game:no-hints',
      name: 'No hints',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!created.ok) throw new Error('expected create to succeed');
    expect(created.set.config.hints).toEqual(DEFAULT_CYCLE_CONFIG.hints);
  });

  it('leaves an existing set config untouched when the global default changes', async () => {
    const service = makeService();
    const created = await service.createFromGame({
      gameId: 'game:stable',
      name: 'Stable',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!created.ok) throw new Error('expected create to succeed');

    await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, {
      enabledLevels: [1],
      firstHintLevel: 1,
    });

    const stored = await trainingSetsRepository.get(created.set.id);
    expect(stored?.config.hints).toEqual(DEFAULT_CYCLE_CONFIG.hints);
  });

  it('uses an injected readDefaultHintConfig when provided', async () => {
    const service = new TrainingSetsService({
      sets: trainingSetsRepository,
      puzzles: puzzlesRepository,
      games: gamesRepository,
      attempts: attemptsRepository,
      cycles: trainingCyclesRepository,
      now: () => NOW,
      newId,
      readDefaultHintConfig: async () => ({ enabledLevels: [3], firstHintLevel: 3 }),
    });

    const created = await service.createFromGame({
      gameId: 'game:injected',
      name: 'Injected',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!created.ok) throw new Error('expected create to succeed');
    expect(created.set.config.hints).toEqual({ enabledLevels: [3], firstHintLevel: 3 });
  });
});
