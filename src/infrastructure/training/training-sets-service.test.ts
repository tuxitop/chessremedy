/**
 * TrainingSetsService tests (Feature 013, Stage C).
 *
 * Real Dexie over fake-indexeddb (shared test setup), with a deterministic
 * injected clock/id. Covers: create from a game and from the pool (platform /
 * time-control filters), a zero-resolution empty set (explicit flag, still
 * persisted), manual selection order with missing ids dropped, and the typed
 * rename/config/archive/unarchive/delete lifecycle. No engine, no network.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/infrastructure/db/database';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { AUTO_SET_ALL_ID, AUTO_SET_RANDOM_ID, DEFAULT_CYCLE_CONFIG } from '@/domain/training';
import { legitimateFirstTryRows } from '@/domain/training/test-support';
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
    now: () => NOW,
    newId,
  });
}

/** A game-scoped puzzle row (the base fixture with overridden provenance). */
function gamePuzzle(gameId: string, ply: number, overrides: Partial<PuzzleRow> = {}): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: gameId, sourcePly: ply, ...overrides };
}

/** Persist three clean first-try rows (three distinct cycles) for one puzzle. */
async function masterPuzzle(puzzleId: string): Promise<void> {
  for (const row of legitimateFirstTryRows(puzzleId, ['cycle:1', 'cycle:2', 'cycle:3'])) {
    await attemptsRepository.addAttempt(row);
  }
}

describe('TrainingSetsService', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
    await db.games.clear();
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

  it('ensureAutoSets seeds both auto sets idempotently with derived membership', async () => {
    await puzzlesRepository.addIfAbsent([
      gamePuzzle('game:auto', 6, { difficulty: 30 }),
      gamePuzzle('game:auto', 8, { difficulty: 10 }),
    ]);
    const service = makeService();
    await service.ensureAutoSets();

    const all = await trainingSetsRepository.get(AUTO_SET_ALL_ID);
    expect(all?.name).toBe('All puzzles');
    expect(all?.status).toBe('active');
    expect(all?.source).toEqual({ kind: 'auto', recipe: { kind: 'allPuzzles' } });
    expect(all?.config.targetAccuracy).toBe(1);
    expect(all?.puzzleIds).toEqual(['game:auto:8', 'game:auto:6']);

    const random = await trainingSetsRepository.get(AUTO_SET_RANDOM_ID);
    expect(random?.name).toBe('Woodpecker random');
    expect(random?.source).toEqual({
      kind: 'auto',
      recipe: { kind: 'woodpeckerRandom', size: 200 },
    });
    expect(random?.puzzleIds).toEqual(['game:auto:8', 'game:auto:6']);

    // Idempotent and never overwriting: a tampered row survives a re-seed and
    // no duplicate row is created.
    await db.trainingSets.put({ ...all!, puzzleIds: ['tampered:1'] });
    await service.ensureAutoSets();
    expect((await trainingSetsRepository.get(AUTO_SET_ALL_ID))?.puzzleIds).toEqual(['tampered:1']);
    expect(await db.trainingSets.count()).toBe(2);
  });

  it('ensureAutoSets excludes mastered puzzles from the initial membership', async () => {
    await puzzlesRepository.addIfAbsent([
      gamePuzzle('game:auto', 6, { difficulty: 10 }),
      gamePuzzle('game:auto', 8, { difficulty: 20 }),
    ]);
    await masterPuzzle('game:auto:6');

    await makeService().ensureAutoSets();

    const all = await trainingSetsRepository.get(AUTO_SET_ALL_ID);
    expect(all?.puzzleIds).toEqual(['game:auto:8']);
  });

  it('refuses every mutation of a system-managed auto set', async () => {
    await makeService().ensureAutoSets();
    const service = makeService();

    expect(await service.rename(AUTO_SET_ALL_ID, 'Nope')).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.updateConfig(AUTO_SET_ALL_ID, DEFAULT_CYCLE_CONFIG)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.archive(AUTO_SET_ALL_ID)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.unarchive(AUTO_SET_RANDOM_ID)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });
    expect(await service.delete(AUTO_SET_ALL_ID)).toEqual({
      ok: false,
      reason: 'auto-set-immutable',
    });

    const stored = await trainingSetsRepository.get(AUTO_SET_ALL_ID);
    expect(stored?.name).toBe('All puzzles');
    expect(stored?.status).toBe('active');
  });

  it('list returns the seeded auto sets alongside user sets', async () => {
    await makeService().ensureAutoSets();
    const created = await makeService().createFromGame({
      gameId: 'game:list',
      name: 'From game',
      ordering: 'difficultyAsc',
      targetSize: 10,
    });
    if (!created.ok) throw new Error('expected create to succeed');

    const ids = (await makeService().list()).map((set) => set.id);
    expect(ids).toContain(AUTO_SET_ALL_ID);
    expect(ids).toContain(AUTO_SET_RANDOM_ID);
    expect(ids).toContain(created.set.id);
  });
});
