import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { parseTimeControl, timeControlProfileForSource } from '@/domain/chess/timeControl';
import type { GameSource } from '@/domain/chess/gameSource';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

interface PreV11Row {
  readonly id: string;
  readonly source: GameSource;
  readonly timeControl: string;
  readonly normalizedTimeControl: string;
  readonly timeControlModel?: unknown;
}

function gameRow(
  id: string,
  source: GameSource,
  timeControl: string,
  normalizedTimeControl: string,
  timeControlModel?: unknown,
): PreV11Row & Record<string, unknown> {
  return {
    id,
    source,
    externalId: null,
    playedAt: null,
    whitePlayer: { name: 'a', rating: null },
    blackPlayer: { name: 'b', rating: null },
    result: '*',
    timeControl,
    normalizedTimeControl,
    ...(timeControlModel === undefined ? {} : { timeControlModel }),
    userColor: 'white',
    pgn: '',
    importedAt: 1,
    updatedAt: 1,
  };
}

/** Build a real pre-v11 database at schema v10 (mirrors the v10 harness). */
async function buildV10Database(name: string): Promise<void> {
  const v10 = new Dexie(name);
  v10.version(1).stores({ settings: '&key' });
  v10.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
  v10.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
  v10.version(4).stores({
    analysisJobs: '&id, gameId, state, updatedAt',
    analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
    positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
  });
  v10.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
  v10
    .version(6)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async () => {});
  v10.version(7).stores({
    analysisSummaries: '&analysisId, gameId',
    puzzleCandidates: '&[analysisId+sourcePly], sourceGameId, analysisId',
  });
  v10.version(8).stores({
    puzzles: '&[sourceGameId+sourcePly], sourceGameId, analysisId',
  });
  v10.version(9).stores({
    puzzleAttempts:
      '&[cycleId+puzzleId+presentationIndex], [cycleId+puzzleId], cycleId, puzzleId, trainingSetId',
  });
  v10.version(10).stores({
    trainingSets: '&id, status, createdAt',
    trainingCycles: '&id, &[trainingSetId+cycleNumber], trainingSetId, status, startedAt',
  });
  await v10.open();

  // Pre-v11 rows: `timeControlModel` is either absent or carries the v1
  // platform-agnostic category. The migration must ignore the stored category.
  await v10.table('games').bulkAdd([
    gameRow('cc:five-five', 'chesscom', '300+5', 'rapid', {
      category: 'rapid',
      categoryVersion: 1,
    }),
    gameRow('cc:stale', 'chesscom', '300+5', 'classical', {
      category: 'classical',
      categoryVersion: 1,
    }),
    gameRow('cc:long', 'chesscom', '1800', 'classical', {
      category: 'classical',
      categoryVersion: 1,
    }),
    gameRow('li:long', 'lichess', '1800', 'classical', {
      category: 'classical',
      categoryVersion: 1,
    }),
    gameRow('li:five-five', 'lichess', '300+5', 'rapid', {
      category: 'rapid',
      categoryVersion: 1,
    }),
    gameRow('local:five-five', 'local', '300+5', 'rapid'),
    gameRow('fx:five-five', 'fixture', '300+5', 'rapid'),
    gameRow('li:daily', 'lichess', '14 days per move', 'correspondence'),
    gameRow('local:junk', 'local', 'garbage', 'unknown'),
  ]);
  await v10.close();
}

const TABLE_LIST = [
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
] as const;

describe('v10 → v11 schema migration (platform time-control re-normalization)', () => {
  it('re-normalizes every game from its verbatim control and source profile', async () => {
    const name = uniqueName();
    await buildV10Database(name);

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(13);
      // Data-only version: the table list is unchanged.
      expect(migrated.tables.map((t) => t.name)).toEqual([...TABLE_LIST]);

      // Chess.com 5|5 (500 s) moves rapid → blitz.
      const ccFive = await migrated.games.get('cc:five-five');
      expect(ccFive?.normalizedTimeControl).toBe('blitz');
      expect(ccFive?.timeControlModel?.profile).toBe('chesscom');
      expect(ccFive?.timeControlModel?.category).toBe('blitz');
      expect(ccFive?.timeControlModel?.categoryVersion).toBe(2);

      // A stale stored category is corrected, not preserved.
      const stale = await migrated.games.get('cc:stale');
      expect(stale?.normalizedTimeControl).toBe('blitz');

      // Chess.com long (1800 s) moves classical → rapid (no classical group).
      const ccLong = await migrated.games.get('cc:long');
      expect(ccLong?.normalizedTimeControl).toBe('rapid');
      expect(ccLong?.timeControlModel?.profile).toBe('chesscom');

      // Lichess 1800 s stays classical.
      const liLong = await migrated.games.get('li:long');
      expect(liLong?.normalizedTimeControl).toBe('classical');
      expect(liLong?.timeControlModel?.profile).toBe('lichess');

      // Lichess 5|5 stays rapid.
      const liFive = await migrated.games.get('li:five-five');
      expect(liFive?.normalizedTimeControl).toBe('rapid');
      expect(liFive?.timeControlModel?.profile).toBe('lichess');

      // local / fixture use the generic (= lichess) profile.
      const localFive = await migrated.games.get('local:five-five');
      expect(localFive?.normalizedTimeControl).toBe('rapid');
      expect(localFive?.timeControlModel?.profile).toBe('generic');
      const fxFive = await migrated.games.get('fx:five-five');
      expect(fxFive?.normalizedTimeControl).toBe('rapid');
      expect(fxFive?.timeControlModel?.profile).toBe('generic');

      // Correspondence and unknown keep their category.
      expect((await migrated.games.get('li:daily'))?.normalizedTimeControl).toBe('correspondence');
      expect((await migrated.games.get('local:junk'))?.normalizedTimeControl).toBe('unknown');
    } finally {
      migrated.close();
    }
  });

  it('is idempotent: re-running yields byte-identical rows', async () => {
    const name = uniqueName();
    await buildV10Database(name);

    const first = new ChessRemedyDatabase(name);
    let snapshot: string;
    try {
      await first.open();
      snapshot = JSON.stringify(await first.games.get('cc:five-five'));
    } finally {
      first.close();
    }

    const second = new ChessRemedyDatabase(name);
    try {
      await second.open();
      expect(JSON.stringify(await second.games.get('cc:five-five'))).toBe(snapshot);
    } finally {
      second.close();
    }

    // The stored model equals an independent recomputation from (timeControl, source).
    const stored = JSON.parse(snapshot) as {
      timeControl: string;
      source: GameSource;
      timeControlModel: unknown;
    };
    const expected = parseTimeControl(
      stored.timeControl,
      timeControlProfileForSource(stored.source),
    );
    expect(stored.timeControlModel).toEqual(expected);
  });
});
