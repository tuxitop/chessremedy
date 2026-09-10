import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { fixtureGame } from '@/domain/chess/fixtures';
import { gameEndOf } from '@/domain/chess/gameEnd';
import { makeRecords } from '@/domain/analysis/test-support';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v6 → v7 schema migration', () => {
  it('adds the Feature-010 tables additively and leaves pre-v7 rows untouched', async () => {
    const name = uniqueName();
    const game = fixtureGame('cc-bullet-blunder'); // ...Qh4# 0-1
    const analysisId = 'lichess:v6|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal';
    const end = gameEndOf(game.moves, game.result);

    // A real pre-v7 database at schema v6 (built the same way as the earlier
    // migration tests, mirroring the real v1..v6 schema deltas) holding
    // v6-shaped game rows and a completed analysis run, but no Feature-010
    // tables. Rows are written with `put`/`bulkAdd` (Dexie's `bulkPut` fails
    // against a hand-built pre-versioned store under fake-indexeddb).
    const v6 = new Dexie(name);
    v6.version(1).stores({ settings: '&key' });
    v6.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v6.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
    v6.version(4).stores({
      analysisJobs: '&id, gameId, state, updatedAt',
      analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
      positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
    });
    v6.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v6.version(6)
      .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
      .upgrade(async () => {});
    await v6.open();

    await v6.table('settings').put({ key: 'theme', value: 'dark', updatedAt: 1 });
    await v6.table('games').put({
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
    await v6.table('analyses').bulkAdd([...makeRecords(game.id, analysisId, 2)]);
    await v6.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      // The real schema now lands on v9 (Feature-011 puzzles + Feature-012
      // puzzleAttempts); this test proves the v6→v7 additive tables survive
      // the later v8/v9 milestones untouched.
      expect(migrated.verno).toBe(10);
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
      ]);

      // The new tables exist and are empty.
      expect(await migrated.analysisSummaries.count()).toBe(0);
      expect(await migrated.puzzleCandidates.count()).toBe(0);
      expect(await migrated.puzzles.count()).toBe(0);

      // Pre-v7 rows (games, settings, analyses) are untouched.
      const stored = await migrated.games.get(game.id);
      expect(stored).toBeDefined();
      expect(stored!.moveCount).toBe(end.moveCount);
      expect(stored!.termination).toBe(end.termination);
      expect((await migrated.settings.get('theme'))?.value).toBe('dark');
      expect(await migrated.analyses.where('analysisId').equals(analysisId).count()).toBe(2);

      // The new tables are immediately usable.
      await migrated.analysisSummaries.put({
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
        detectionState: 'queued',
        missedTacticCount: null,
        detectionVersion: null,
        updatedAt: 1,
      });
      expect(await migrated.analysisSummaries.count()).toBe(1);
    } finally {
      migrated.close();
    }
  });
});
