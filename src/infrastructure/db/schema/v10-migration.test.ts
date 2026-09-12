import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { DexiePuzzleAttemptsRepository } from '../attempts-repository';
import { DexieTrainingSetsRepository } from '../training-sets-repository';
import { DexieTrainingCyclesRepository } from '../training-cycles-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { gameEndOf } from '@/domain/chess/gameEnd';
import { makeRecords } from '@/domain/analysis/test-support';
import { puzzleFixture, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import {
  attemptRowFixture,
  cycleContextFixture,
  cycleFixture,
  setFixture,
} from '@/domain/training/test-support';
import { DETECTION_VERSION } from '@/domain/tactics';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v9 → v10 schema migration', () => {
  it('creates the Feature-013 tables on a fresh empty database at v11', async () => {
    const name = uniqueName();
    const fresh = new ChessRemedyDatabase(name);
    try {
      await fresh.open();
      expect(fresh.verno).toBe(12);
      expect(fresh.tables.map((t) => t.name)).toEqual([
        'settings',
        'games',
        'importJobs',
        'analysisJobs',
        'analyses',
        'positionAnalysisCache',
        'analysisSummaries',
        'puzzleCandidates',
        'puzzles',
        'puzzleAttempts',
        'trainingSets',
        'trainingCycles',
        'syncState',
        'syncTombstones',
        'syncBackups',
      ]);

      // Both Feature-013 tables exist, start empty and are immediately usable.
      expect(await fresh.trainingSets.count()).toBe(0);
      expect(await fresh.trainingCycles.count()).toBe(0);

      const sets = new DexieTrainingSetsRepository(fresh);
      const cycles = new DexieTrainingCyclesRepository(fresh);
      const set = setFixture({ id: 'empty:set' });
      await sets.create(set);
      expect(await sets.get(set.id)).toEqual(set);
      expect(await sets.list()).toEqual([set]);

      const cycle = cycleFixture({
        id: 'empty:cycle',
        trainingSetId: set.id,
        cycleNumber: 1,
      });
      await cycles.create(cycle);
      expect(await cycles.get(cycle.id)).toEqual(cycle);
      expect(await cycles.getByNumber(set.id, 1)).toEqual(cycle);
      expect(await cycles.listForSet(set.id)).toEqual([cycle]);
    } finally {
      fresh.close();
    }
  });

  it('adds the Feature-013 trainingSets/trainingCycles tables additively and leaves pre-v10 rows untouched', async () => {
    const name = uniqueName();
    const game = fixtureGame('cc-bullet-blunder'); // ...Qh4# 0-1
    const analysisId = 'lichess:v9|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal';
    const end = gameEndOf(game.moves, game.result);

    // A real pre-v10 database at schema v9 (built the same way as the earlier
    // migration tests, mirroring the real v1..v9 schema deltas) holding
    // v6-shaped game/analysis rows, Feature-010 summary/candidate rows, a
    // Feature-011 puzzle row and a Feature-012 attempt row, but neither
    // `trainingSets` nor `trainingCycles`. Rows are written with
    // `put`/`bulkAdd` (Dexie's `bulkPut` fails against a hand-built
    // pre-versioned store under fake-indexeddb).
    const v9 = new Dexie(name);
    v9.version(1).stores({ settings: '&key' });
    v9.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v9.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
    v9.version(4).stores({
      analysisJobs: '&id, gameId, state, updatedAt',
      analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
      positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
    });
    v9.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v9.version(6)
      .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
      .upgrade(async () => {});
    v9.version(7).stores({
      analysisSummaries: '&analysisId, gameId',
      puzzleCandidates: '&[analysisId+sourcePly], sourceGameId, analysisId',
    });
    v9.version(8).stores({
      puzzles: '&[sourceGameId+sourcePly], sourceGameId, analysisId',
    });
    v9.version(9).stores({
      puzzleAttempts:
        '&[cycleId+puzzleId+presentationIndex], [cycleId+puzzleId], cycleId, puzzleId, trainingSetId',
    });
    await v9.open();

    await v9.table('settings').put({ key: 'theme', value: 'dark', updatedAt: 1 });
    await v9.table('games').put({
      id: game.id,
      source: game.source,
      externalId: game.externalId,
      playedAt: game.playedAt,
      whitePlayer: game.whitePlayer,
      blackPlayer: game.blackPlayer,
      result: game.result,
      timeControl: game.timeControl,
      normalizedTimeControl: game.normalizedTimeControl,
      userColor: game.userColor,
      pgn: game.pgn,
      moveCount: end.moveCount,
      termination: end.termination,
      importedAt: 1,
      updatedAt: 1,
    });
    await v9.table('analyses').bulkAdd([...makeRecords(game.id, analysisId, 2)]);
    await v9.table('analysisSummaries').put({
      analysisId,
      gameId: game.id,
      userColor: 'white',
      classificationCounts: {
        best: 0,
        good: 0,
        inaccuracy: 0,
        mistake: 0,
        blunder: 2,
      },
      userMoves: 2,
      totalMoves: 3,
      accuracy: 30,
      accuracyMoves: 2,
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: DETECTION_VERSION,
      updatedAt: 1,
    });
    await v9.table('puzzleCandidates').put(puzzleFixture('material-combination'));
    const puzzle = puzzleRowFixture('mate-one');
    await v9.table('puzzles').put({ ...puzzle });
    const attempt = attemptRowFixture({
      row: puzzle,
      context: cycleContextFixture('migrated-cycle', '', 1),
    });
    await v9.table('puzzleAttempts').put({ ...attempt });
    await v9.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(12);
      expect(migrated.tables.map((t) => t.name)).toEqual([
        'settings',
        'games',
        'importJobs',
        'analysisJobs',
        'analyses',
        'positionAnalysisCache',
        'analysisSummaries',
        'puzzleCandidates',
        'puzzles',
        'puzzleAttempts',
        'trainingSets',
        'trainingCycles',
        'syncState',
        'syncTombstones',
        'syncBackups',
      ]);

      // Pre-v10 rows (settings, game, analyses, summaries, candidates, puzzle,
      // attempt) are untouched.
      expect((await migrated.settings.get('theme'))?.value).toBe('dark');
      const stored = await migrated.games.get(game.id);
      expect(stored).toBeDefined();
      expect(stored!.moveCount).toBe(end.moveCount);
      expect(stored!.termination).toBe(end.termination);
      expect(await migrated.analyses.where('analysisId').equals(analysisId).count()).toBe(2);
      const summary = await migrated.analysisSummaries.get(analysisId);
      expect(summary?.detectionState).toBe('completed');
      expect(await migrated.puzzleCandidates.count()).toBe(1);
      expect(await migrated.puzzles.count()).toBe(1);
      expect(await migrated.puzzles.get(['fixture:mate-one', 6])).toEqual(puzzle);
      expect(await migrated.puzzleAttempts.count()).toBe(1);
      expect(
        await new DexiePuzzleAttemptsRepository(migrated).getAttempt(
          attempt.cycleId,
          attempt.puzzleId,
          attempt.presentationIndex,
        ),
      ).toEqual(attempt);

      // Both new tables exist and are empty …
      expect(await migrated.trainingSets.count()).toBe(0);
      expect(await migrated.trainingCycles.count()).toBe(0);

      // … and are immediately usable through the Feature-013 repositories.
      const sets = new DexieTrainingSetsRepository(migrated);
      const cycles = new DexieTrainingCyclesRepository(migrated);
      const set = setFixture({
        id: 'migrated:set',
        puzzleIds: [puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly)],
      });
      await sets.create(set);
      expect(await sets.get(set.id)).toEqual(set);
      expect(await sets.list()).toEqual([set]);

      const cycle = cycleFixture({
        id: 'migrated:cycle',
        trainingSetId: set.id,
        cycleNumber: 1,
        puzzleIds: [puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly)],
      });
      await cycles.create(cycle);
      expect(await cycles.get(cycle.id)).toEqual(cycle);
      expect(await cycles.getByNumber(set.id, 1)).toEqual(cycle);
      expect(await cycles.listForSet(set.id)).toEqual([cycle]);
    } finally {
      migrated.close();
    }
  });
});
