import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { fixtureGame } from '@/domain/chess/fixtures';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

describe('v4 → v5 schema migration', () => {
  it('backfills the structured time control and re-normalizes legacy unknowns', async () => {
    const name = uniqueName();
    const fixture = fixtureGame('cc-rapid-missed-tactic'); // TimeControl "600+5"

    // A real pre-v5 database: games rows without a structured time control.
    const v4 = new Dexie(name);
    v4.version(1).stores({ settings: '&key' });
    v4.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl' });
    v4.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
    v4.version(4).stores({
      analysisJobs: '&id, gameId, state, updatedAt',
      analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
      positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
    });
    await v4.open();

    const row = (timeControl: string, normalizedTimeControl: string, id: string) => ({
      id,
      source: 'local',
      externalId: null,
      playedAt: null,
      whitePlayer: { name: 'a', rating: null },
      blackPlayer: { name: 'b', rating: null },
      result: '*' as const,
      timeControl,
      normalizedTimeControl,
      userColor: 'white' as const,
      pgn: '',
      importedAt: 1,
      updatedAt: 1,
    });
    await v4
      .table('games')
      .bulkAdd([
        row(fixture.timeControl, fixture.normalizedTimeControl, 'chesscom:rapid'),
        row('14 days per move', 'unknown', 'lichess:legacy-daily'),
        row('garbage', 'unknown', 'local:junk'),
      ]);
    await v4.close();

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(12);

      const rapid = await migrated.games.get('chesscom:rapid');
      expect(rapid?.timeControlModel?.display).toBe('10|5');
      expect(rapid?.timeControlModel?.category).toBe('rapid');
      expect(rapid?.normalizedTimeControl).toBe('rapid');

      // Legacy Lichess correspondence (day-words) was previously `unknown`.
      const daily = await migrated.games.get('lichess:legacy-daily');
      expect(daily?.timeControlModel?.kind).toBe('correspondence');
      expect(daily?.timeControlModel?.daysPerTurn).toBe(14);
      expect(daily?.timeControlModel?.display).toBe('14 days/move');
      expect(daily?.normalizedTimeControl).toBe('correspondence');

      // Unparseable rows stay unknown.
      const junk = await migrated.games.get('local:junk');
      expect(junk?.timeControlModel?.category).toBe('unknown');
      expect(junk?.timeControlModel?.display).toBe('Unknown');
      expect(junk?.normalizedTimeControl).toBe('unknown');
    } finally {
      await migrated.close();
    }
  });
});
