import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { DexiePuzzlesRepository } from '../puzzles-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { gameEndOf } from '@/domain/chess/gameEnd';
import { makeRecords } from '@/domain/analysis/test-support';
import { puzzleFixture, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { DETECTION_VERSION } from '@/domain/tactics';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v7 → v8 schema migration', () => {
  it('adds the Feature-011 puzzles table additively and leaves pre-v8 rows untouched', async () => {
    const name = uniqueName();
    const game = fixtureGame('cc-bullet-blunder'); // ...Qh4# 0-1
    const analysisId = 'lichess:v7|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal';
    const end = gameEndOf(game.moves, game.result);

    // A real pre-v8 database at schema v7 (built the same way as the earlier
    // migration tests, mirroring the real v1..v7 schema deltas) holding
    // v6-shaped game/analysis rows plus Feature-010 summary and candidate
    // rows, but no `puzzles` table. The summary row is written WITHOUT the
    // additive Feature-011 puzzle fields, exactly as a real v7 row looks.
    // Rows are written with `put`/`bulkAdd` (Dexie's `bulkPut` fails against
    // a hand-built pre-versioned store under fake-indexeddb).
    const v7 = new Dexie(name);
    v7.version(1).stores({ settings: '&key' });
    v7.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v7.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
    v7.version(4).stores({
      analysisJobs: '&id, gameId, state, updatedAt',
      analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
      positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
    });
    v7.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v7.version(6)
      .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
      .upgrade(async () => {});
    v7.version(7).stores({
      analysisSummaries: '&analysisId, gameId',
      puzzleCandidates: '&[analysisId+sourcePly], sourceGameId, analysisId',
    });
    await v7.open();

    await v7.table('settings').put({ key: 'theme', value: 'dark', updatedAt: 1 });
    await v7.table('games').put({
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
    await v7.table('analyses').bulkAdd([...makeRecords(game.id, analysisId, 2)]);
    await v7.table('analysisSummaries').put({
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
    await v7.table('puzzleCandidates').put(puzzleFixture('material-combination'));
    await v7.close();

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

      // Pre-v8 rows (settings, game, analyses, summaries, candidates) are
      // untouched, and the additive Feature-011 summary fields are still
      // absent on the migrated row (undefined = no generation pass yet).
      expect((await migrated.settings.get('theme'))?.value).toBe('dark');
      const stored = await migrated.games.get(game.id);
      expect(stored).toBeDefined();
      expect(stored!.moveCount).toBe(end.moveCount);
      expect(stored!.termination).toBe(end.termination);
      expect(await migrated.analyses.where('analysisId').equals(analysisId).count()).toBe(2);
      const summary = await migrated.analysisSummaries.get(analysisId);
      expect(summary?.detectionState).toBe('completed');
      expect(summary?.puzzleState).toBeUndefined();
      expect(await migrated.puzzleCandidates.count()).toBe(1);

      // The new puzzles table exists and is empty …
      expect(await migrated.puzzles.count()).toBe(0);

      // … and is immediately usable through the Feature-011 repository.
      const puzzles = new DexiePuzzlesRepository(migrated);
      expect(await puzzles.addIfAbsent([puzzleRowFixture('mate-one')])).toBe(1);
      expect(await migrated.puzzles.count()).toBe(1);
    } finally {
      migrated.close();
    }
  });
});
