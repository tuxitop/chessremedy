import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessRemedyDatabase } from '../database';
import { PERSISTENCE_SCHEMA_VERSION } from '@/config/app-config';

let sequence = 0;

function uniqueName(): string {
  sequence += 1;
  return `chessremedy-test-${Date.now()}-${sequence}`;
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

/** Build a real pre-v13 database at schema v12 (mirrors the v12 harness). */
async function buildV12Database(name: string): Promise<void> {
  const v12 = new Dexie(name);
  v12.version(1).stores({ settings: '&key' });
  v12.version(2).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
  v12.version(3).stores({ importJobs: '&id, provider, username, status, updatedAt' });
  v12.version(4).stores({
    analysisJobs: '&id, gameId, state, updatedAt',
    analyses: '&[analysisId+ply], [gameId+analysisId], gameId, analysisId',
    positionAnalysisCache: '&key, profile, engineName, engineVersion, engineBuild, analyzedAt',
  });
  v12.version(5).stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' });
  v12
    .version(6)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async () => {});
  v12.version(7).stores({
    analysisSummaries: '&analysisId, gameId',
    puzzleCandidates: '&[analysisId+sourcePly], sourceGameId, analysisId',
  });
  v12.version(8).stores({
    puzzles: '&[sourceGameId+sourcePly], sourceGameId, analysisId',
  });
  v12.version(9).stores({
    puzzleAttempts:
      '&[cycleId+puzzleId+presentationIndex], [cycleId+puzzleId], cycleId, puzzleId, trainingSetId',
  });
  v12.version(10).stores({
    trainingSets: '&id, status, createdAt',
    trainingCycles: '&id, &[trainingSetId+cycleNumber], trainingSetId, status, startedAt',
  });
  v12
    .version(11)
    .stores({ games: '&id, source, playedAt, normalizedTimeControl, timeControl' })
    .upgrade(async () => {});
  v12
    .version(12)
    .stores({
      syncState: '&key',
      syncTombstones: '&id, kind, recordId, deletedAt',
      syncBackups: '&id, createdAt',
    })
    .upgrade(async () => {});
  await v12.open();
  await v12.table('settings').put({ key: 'theme', value: 'dark', updatedAt: 1 });
  await v12.close();
}

describe('v12 → v13 schema migration (Feature 020 puzzleSchedules)', () => {
  it('adds the derived store additively and starts empty without data loss', async () => {
    const name = uniqueName();
    await buildV12Database(name);

    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      expect(migrated.verno).toBe(13);
      expect(migrated.tables.map((t) => t.name)).toEqual([...TABLE_LIST]);
      expect(await migrated.puzzleSchedules.count()).toBe(0);
      // Existing data survives the additive migration.
      expect((await migrated.settings.get('theme'))?.value).toBe('dark');
      expect(PERSISTENCE_SCHEMA_VERSION).toBe(13);
    } finally {
      migrated.close();
    }
  });

  it('is idempotent: reopening at v13 leaves the new store empty', async () => {
    const name = uniqueName();
    await buildV12Database(name);

    const first = new ChessRemedyDatabase(name);
    try {
      await first.open();
      await first.puzzleSchedules.put({
        puzzleId: 'fixture:mate-one:6',
        dueAt: 1,
        lastReviewedAt: null,
        state: 'learning',
        stability: 0,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        learningStep: 0,
        lastGrade: null,
        scheduleVersion: 1,
        schedulerParamsVersion: 1,
        updatedAt: 1,
      });
    } finally {
      first.close();
    }

    const second = new ChessRemedyDatabase(name);
    try {
      await second.open();
      expect(second.verno).toBe(13);
      expect(await second.puzzleSchedules.count()).toBe(1);
    } finally {
      second.close();
    }
  });

  it('exposes the derived store with a dueAt index', async () => {
    const name = uniqueName();
    await buildV12Database(name);
    const migrated = new ChessRemedyDatabase(name);
    try {
      await migrated.open();
      const table = migrated.table('puzzleSchedules');
      expect(table.schema.primKey.keyPath).toBe('puzzleId');
      expect(table.schema.indexes.map((index) => index.name)).toContain('dueAt');
    } finally {
      migrated.close();
    }
  });
});
