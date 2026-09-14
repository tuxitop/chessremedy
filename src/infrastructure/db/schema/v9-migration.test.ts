import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { DexiePuzzleAttemptsRepository } from '../attempts-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { gameEndOf } from '@/domain/chess/gameEnd';
import { makeRecords } from '@/domain/analysis/test-support';
import { puzzleFixture, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { attemptRowFixture, cycleContextFixture } from '@/domain/training/test-support';
import { DETECTION_VERSION } from '@/domain/tactics';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v8 → v9 schema migration', () => {
  it('adds the Feature-012 puzzleAttempts table additively and leaves pre-v9 rows untouched', async () => {
    const name = uniqueName();
    const game = fixtureGame('cc-bullet-blunder'); // ...Qh4# 0-1
    const analysisId = 'lichess:v8|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal';
    const end = gameEndOf(game.moves, game.result);

    // A real pre-v9 database at schema v8 (built the same way as the earlier
    // migration tests, mirroring the real v1..v8 schema deltas) holding
    // v6-shaped game/analysis rows, Feature-010 summary/candidate rows and a
    // Feature-011 puzzle row, but no `puzzleAttempts` table. Rows are written
    // with `put`/`bulkAdd` (Dexie's `bulkPut` fails against a hand-built
    // pre-versioned store under fake-indexeddb).
    const v8 = new Dexie(name);
    v8.version(1).stores({ settings: '&key' });
    v8.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v8.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
    v8.version(4).stores({
      analysisJobs: '&id, gameId, state, updatedAt',
      analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
      positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
    });
    v8.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v8.version(6)
      .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
      .upgrade(async () => {});
    v8.version(7).stores({
      analysisSummaries: '&analysisId, gameId',
      puzzleCandidates: '&[analysisId+sourcePly], sourceGameId, analysisId',
    });
    v8.version(8).stores({
      puzzles: '&[sourceGameId+sourcePly], sourceGameId, analysisId',
    });
    await v8.open();

    await v8.table('settings').put({ key: 'theme', value: 'dark', updatedAt: 1 });
    await v8.table('games').put({
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
    await v8.table('analyses').bulkAdd([...makeRecords(game.id, analysisId, 2)]);
    await v8.table('analysisSummaries').put({
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
    await v8.table('puzzleCandidates').put(puzzleFixture('material-combination'));
    await v8.table('puzzles').put({ ...puzzleRowFixture('mate-one') });
    await v8.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(13);
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
        'puzzleSchedules',
      ]);

      // Pre-v9 rows (settings, game, analyses, summaries, candidates, puzzle)
      // are untouched.
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
      expect(await migrated.puzzles.get(['fixture:mate-one', 6])).toEqual(
        puzzleRowFixture('mate-one'),
      );

      // The new puzzleAttempts table exists and is empty …
      expect(await migrated.puzzleAttempts.count()).toBe(0);

      // … and is immediately usable through the Feature-012 repository
      // (first-write-wins on the natural key).
      const attempts = new DexiePuzzleAttemptsRepository(migrated);
      const attempt = attemptRowFixture({
        row: puzzleRowFixture('mate-one'),
        context: cycleContextFixture('migrated-cycle', '', 1),
      });
      expect(await attempts.addAttempt(attempt)).toBe('added');
      expect(await attempts.addAttempt(attempt)).toBe('already-present');
      expect(await migrated.puzzleAttempts.count()).toBe(1);
      expect(
        await attempts.getAttempt(attempt.cycleId, attempt.puzzleId, attempt.presentationIndex),
      ).toEqual(attempt);
    } finally {
      migrated.close();
    }
  });
});
