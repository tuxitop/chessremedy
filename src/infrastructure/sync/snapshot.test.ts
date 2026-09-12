import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_KEYS } from '@/config/app-config';
import { fixtureGame } from '@/domain/chess/fixtures';
import { makeJob, makeRecords, TEST_ENGINE } from '@/domain/analysis/test-support';
import { puzzleFixture, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { cycleAttemptFixture, cycleFixture, setFixture } from '@/domain/training/test-support';
import {
  makeTombstone,
  serializeEnvelope,
  type SyncEnvelopeCollectionsV1,
  type SyncEnvelopeV1,
} from '@/domain/sync';
import type { EngineAnalysisResult } from '@/infrastructure/engine/types';
import { db } from '@/infrastructure/db/database';
import { gamesRepository, type GameRow } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { puzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { SYNC_STATE_KEYS, syncStateRepository } from '@/infrastructure/db/sync-state-repository';
import { DexieEngineAnalysisCache } from '@/infrastructure/db/engine-cache-repository';
import { DexieSyncCollectionsGateway } from './snapshot';

const gateway = new DexieSyncCollectionsGateway();

function engineResult(): EngineAnalysisResult {
  return {
    jobId: 'engine-job',
    position: 'start',
    profile: 'normal',
    lines: [
      {
        multipv: 1,
        evaluation: { cp: 10 },
        principalVariation: [{ uci: 'e2e4' }],
        wdl: null,
      },
    ],
    engine: TEST_ENGINE,
    timeMs: 1,
  };
}

function makeEnvelope(overrides: Partial<SyncEnvelopeCollectionsV1> = {}): SyncEnvelopeV1 {
  return {
    version: 1,
    exportedAt: '2024-01-01T00:00:00.000Z',
    deviceId: 'remote-device',
    collections: {
      games: [],
      analysis: { analyses: [], analysisJobs: [], analysisSummaries: [], puzzleCandidates: [] },
      puzzles: [],
      trainingSets: [],
      trainingCycles: [],
      puzzleAttempts: [],
      settings: [],
      tombstones: [],
      ...overrides,
    },
  };
}

async function clearAll(): Promise<void> {
  await db.games.clear();
  await db.analyses.clear();
  await db.analysisJobs.clear();
  await db.analysisSummaries.clear();
  await db.puzzleCandidates.clear();
  await db.puzzles.clear();
  await db.puzzleAttempts.clear();
  await db.trainingSets.clear();
  await db.trainingCycles.clear();
  await db.settings.clear();
  await db.positionAnalysisCache.clear();
  await db.syncState.clear();
  await db.syncTombstones.clear();
  await db.syncBackups.clear();
}

async function seed(): Promise<{ gameId: string; analysisId: string }> {
  const game = fixtureGame('cc-blitz-clean');
  await gamesRepository.saveGame(game);
  const job = makeJob(game.id, 2);
  await analysisJobsRepository.putJob(job);
  await analysesRepository.replaceAnalysis(makeRecords(game.id, job.id, 2));
  await puzzleCandidatesRepository.bulkPutForAnalysis([puzzleFixture('mate-one')]);
  await puzzlesRepository.addIfAbsent([puzzleRowFixture('mate-one')]);
  await trainingSetsRepository.create(setFixture({ updatedAt: 5 }));
  await trainingCyclesRepository.create(cycleFixture({ updatedAt: 5 }));
  await attemptsRepository.addAttempt(cycleAttemptFixture());
  await db.settings.bulkPut([
    { key: SETTINGS_KEYS.theme, value: 'dark', updatedAt: 1 },
    { key: SETTINGS_KEYS.legacyAutoSetsCleaned, value: true, updatedAt: 1 },
    { key: 'sync.refreshToken', value: 'super-secret-token', updatedAt: 1 },
  ]);
  return { gameId: game.id, analysisId: job.id };
}

describe('DexieSyncCollectionsGateway', () => {
  beforeEach(clearAll);

  it('exports every leaf collection and round-trips them through applyEnvelope', async () => {
    const { gameId, analysisId } = await seed();

    const envelope = await gateway.exportLocal();
    expect(envelope.version).toBe(1);
    expect(envelope.deviceId.length).toBeGreaterThan(0);
    expect(envelope.collections.games.map((row) => row.id)).toContain(gameId);
    expect(envelope.collections.analysis.analyses).toHaveLength(2);
    expect(envelope.collections.analysis.analysisJobs.map((job) => job.id)).toContain(analysisId);
    expect(envelope.collections.analysis.puzzleCandidates).toHaveLength(1);
    expect(envelope.collections.puzzles).toHaveLength(1);
    expect(envelope.collections.trainingSets).toHaveLength(1);
    expect(envelope.collections.trainingCycles).toHaveLength(1);
    expect(envelope.collections.puzzleAttempts).toHaveLength(1);
    expect(envelope.collections.settings.map((setting) => setting.key)).toEqual([
      SETTINGS_KEYS.theme,
    ]);
    expect(envelope.collections.tombstones).toEqual([]);

    await clearAll();
    await gateway.applyEnvelope(envelope, { remoteDeviceId: envelope.deviceId });

    expect(await db.games.get(gameId)).toBeDefined();
    expect(await db.analyses.count()).toBe(2);
    expect(await db.analysisJobs.count()).toBe(1);
    expect(await db.puzzleCandidates.count()).toBe(1);
    expect(await db.puzzles.count()).toBe(1);
    expect(await db.trainingSets.count()).toBe(1);
    expect(await db.trainingCycles.count()).toBe(1);
    expect(await db.puzzleAttempts.count()).toBe(1);
    expect(await db.settings.get(SETTINGS_KEYS.theme)).toBeDefined();
    // Non-allowlisted / credential-shaped settings never crossed the wire.
    expect(await db.settings.get(SETTINGS_KEYS.legacyAutoSetsCleaned)).toBeUndefined();
    expect(await db.settings.get('sync.refreshToken')).toBeUndefined();
  });

  it('never includes the engine cache, syncState or syncBackups in the envelope', async () => {
    await db.positionAnalysisCache.put({
      key: 'fen-key',
      analysis: engineResult(),
      profile: 'normal',
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
      analyzedAt: 1,
    });
    await syncStateRepository.set(SYNC_STATE_KEYS.refreshToken, 'super-secret-token');
    await db.syncBackups.put({ id: 'backup-1', createdAt: 1, payload: new Uint8Array([1, 2, 3]) });

    const envelope = await gateway.exportLocal();
    const keys = Object.keys(envelope.collections);
    expect(keys).not.toContain('positionAnalysisCache');
    expect(keys).not.toContain('syncState');
    expect(keys).not.toContain('syncBackups');

    const json = serializeEnvelope(envelope);
    expect(json).not.toContain('super-secret-token');
    expect(json).not.toContain('backup-1');
  });

  it('recomputes the canonical time control on merge so a stale remote category cannot survive', async () => {
    const remoteGame: GameRow = {
      id: 'remote-game',
      source: 'lichess',
      externalId: 'remote-external',
      playedAt: null,
      whitePlayer: { name: 'White', rating: null },
      blackPlayer: { name: 'Black', rating: null },
      result: '*',
      timeControl: '180+2',
      normalizedTimeControl: 'bullet',
      userColor: 'white',
      pgn: '1. e4 e5 *',
      importedAt: 1,
      updatedAt: 10,
    };

    await gateway.applyEnvelope(makeEnvelope({ games: [remoteGame] }), {
      remoteDeviceId: 'remote-device',
    });

    const stored = await db.games.get('remote-game');
    expect(stored?.normalizedTimeControl).toBe('blitz');
    expect(stored?.timeControlModel?.category).toBe('blitz');
  });

  it('applies a game tombstone after upserts, cascading derived rows but leaving the engine cache intact', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const job = makeJob(game.id, 2);
    await analysisJobsRepository.putJob(job);
    await analysesRepository.replaceAnalysis(makeRecords(game.id, job.id, 2));
    const puzzle = { ...puzzleRowFixture('mate-one'), sourceGameId: game.id, analysisId: job.id };
    await puzzlesRepository.addIfAbsent([puzzle]);
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({ puzzleId: puzzleIdOf(game.id, puzzle.sourcePly) }),
    );
    const cache = new DexieEngineAnalysisCache();
    await cache.put('shared-fen-key', engineResult());

    const tombstone = makeTombstone('game', game.id, Date.now() + 10_000, 'remote-device');
    await gateway.applyEnvelope(makeEnvelope({ tombstones: [tombstone] }), {
      remoteDeviceId: 'remote-device',
    });

    expect(await db.games.get(game.id)).toBeUndefined();
    expect(await db.analyses.count()).toBe(0);
    expect(await db.analysisJobs.count()).toBe(0);
    expect(await db.puzzles.count()).toBe(0);
    expect(await db.puzzleAttempts.count()).toBe(0);
    expect(await db.syncTombstones.get(tombstone.id)).toBeDefined();
    // The FEN-keyed engine cache is never purged by a tombstone (ADR-018).
    expect(await cache.count()).toBe(1);
  });
});
