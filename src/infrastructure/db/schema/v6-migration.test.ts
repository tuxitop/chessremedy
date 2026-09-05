import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { fixtureGame } from '@/domain/chess/fixtures';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v5 → v6 schema migration', () => {
  it('backfills moveCount and termination from stored PGNs', async () => {
    const name = uniqueName();
    const mate = fixtureGame('cc-bullet-blunder'); // ...Qh4# 0-1
    const quick = fixtureGame('cc-blitz-clean');

    // A real pre-v6 database (v1..v5) with rows that lack the v6 fields.
    const v5 = new Dexie(name);
    v5.version(1).stores({ settings: '&key' });
    v5.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    v5.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
    v5.version(4).stores({
      analysisJobs: '&id, gameId, state, updatedAt',
      analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
      positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
    });
    v5.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
    await v5.open();

    const rowOf = (game: ReturnType<typeof fixtureGame>, id: string) => ({
      id,
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
      importedAt: 1,
      updatedAt: 1,
    });
    await v5.table('games').bulkAdd([rowOf(mate, 'cc:mate'), rowOf(quick, 'cc:quick')]);
    await v5.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(7);

      const mateRow = await migrated.games.get('cc:mate');
      expect(mateRow?.termination).toBe('checkmate');
      expect(mateRow?.moveCount).toBe(2);

      // Every migrated row carries non-negative counts and a termination.
      const quickRow = await migrated.games.get('cc:quick');
      expect(typeof quickRow?.moveCount).toBe('number');
      expect(quickRow!.moveCount!).toBeGreaterThan(0);
      expect(mateRow).toBeDefined();
    } finally {
      migrated.close();
    }
  });
});
