import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { PERSISTENCE_SCHEMA_VERSION } from '@/config/app-config';
import { puzzleFixture } from '@/domain/puzzle/test-support';
import { cycleFixture } from '@/domain/training/test-support';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
}

const CANDIDATE_ANALYSIS_ID = 'analysis:material-combination';
const CANDIDATE_SOURCE_PLY = 8;
const CYCLE_ID = 'cycle:v12';

/** Build a real pre-v12 database at schema v11 (mirrors the v11 harness). */
async function buildV11Database(name: string): Promise<void> {
  const v11 = new Dexie(name);
  v11.version(1).stores({ settings: '&key' });
  v11.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
  v11.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
  v11.version(4).stores({
    analysisJobs: '&id, gameId, state, updatedAt',
    analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
    positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
  });
  v11.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
  v11
    .version(6)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async () => {});
  v11.version(7).stores({
    analysisSummaries: '&analysisId, gameId',
    puzzleCandidates: '&[analysisId+sourcePly], sourceGameId, analysisId',
  });
  v11.version(8).stores({
    puzzles: '&[sourceGameId+sourcePly], sourceGameId, analysisId',
  });
  v11.version(9).stores({
    puzzleAttempts:
      '&[cycleId+puzzleId+presentationIndex], [cycleId+puzzleId], cycleId, puzzleId, trainingSetId',
  });
  v11.version(10).stores({
    trainingSets: '&id, status, createdAt',
    trainingCycles: '&id, &[trainingSetId+cycleNumber], trainingSetId, status, startedAt',
  });
  v11
    .version(11)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async () => {});
  await v11.open();

  // Pre-v12 rows deliberately lack `updatedAt`, exactly as a real v11 install.
  const { updatedAt: _candidateUpdatedAt, ...preV12Candidate } =
    puzzleFixture('material-combination');
  const { updatedAt: _cycleUpdatedAt, ...preV12Cycle } = cycleFixture({
    id: CYCLE_ID,
    trainingSetId: 'set:v12',
    cycleNumber: 1,
    startedAt: 1_700_000_000_000,
  });
  await v11.table('puzzleCandidates').put(preV12Candidate);
  await v11.table('trainingCycles').put(preV12Cycle);
  await v11.close();
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

describe('v11 → v12 schema migration (Feature 016 sync tables + updatedAt backfill)', () => {
  it('adds the three sync tables and backfills the mutable-row merge timestamps', async () => {
    const name = uniqueName();
    await buildV11Database(name);

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(13);
      expect(migrated.tables.map((t) => t.name)).toEqual([...TABLE_LIST]);

      // The three additive stores exist and start empty.
      expect(await migrated.syncState.count()).toBe(0);
      expect(await migrated.syncTombstones.count()).toBe(0);
      expect(await migrated.syncBackups.count()).toBe(0);

      // `puzzleCandidates.updatedAt` is backfilled from `createdAt`.
      const candidate = await migrated.puzzleCandidates.get([
        CANDIDATE_ANALYSIS_ID,
        CANDIDATE_SOURCE_PLY,
      ]);
      expect(candidate).toBeDefined();
      expect(candidate!.updatedAt).toBe(candidate!.createdAt);

      // `trainingCycles.updatedAt` is backfilled from `startedAt`.
      const cycle = await migrated.trainingCycles.get(CYCLE_ID);
      expect(cycle).toBeDefined();
      expect(cycle!.updatedAt).toBe(cycle!.startedAt);

      expect(PERSISTENCE_SCHEMA_VERSION).toBe(13);
    } finally {
      migrated.close();
    }
  });

  it('is idempotent: reopening at v12 leaves the backfilled rows byte-identical', async () => {
    const name = uniqueName();
    await buildV11Database(name);

    const first = new ChessRemedyDatabase(name);
    let candidateSnapshot: string;
    let cycleSnapshot: string;
    try {
      await first.open();
      candidateSnapshot = JSON.stringify(
        await first.puzzleCandidates.get([CANDIDATE_ANALYSIS_ID, CANDIDATE_SOURCE_PLY]),
      );
      cycleSnapshot = JSON.stringify(await first.trainingCycles.get(CYCLE_ID));
    } finally {
      first.close();
    }

    const second = new ChessRemedyDatabase(name);
    try {
      await second.open();
      expect(
        JSON.stringify(
          await second.puzzleCandidates.get([CANDIDATE_ANALYSIS_ID, CANDIDATE_SOURCE_PLY]),
        ),
      ).toBe(candidateSnapshot);
      expect(JSON.stringify(await second.trainingCycles.get(CYCLE_ID))).toBe(cycleSnapshot);
    } finally {
      second.close();
    }
  });
});
