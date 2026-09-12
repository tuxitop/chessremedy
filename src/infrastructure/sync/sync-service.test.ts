import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropboxContentHash,
  makeTombstone,
  parseEnvelope,
  serializeEnvelope,
  type RemoteFileMetadata,
  type SyncEnvelopeCollectionsV1,
  type SyncEnvelopeV1,
  type SyncStatus,
} from '@/domain/sync';
import { fixtureGame } from '@/domain/chess/fixtures';
import { makeJob, makeRecords, TEST_ENGINE } from '@/domain/analysis/test-support';
import type { EngineAnalysisResult } from '@/infrastructure/engine/types';
import { db } from '@/infrastructure/db/database';
import { gamesRepository, type GameRow } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { SYNC_STATE_KEYS, syncStateRepository } from '@/infrastructure/db/sync-state-repository';
import { tombstonesRepository } from '@/infrastructure/db/tombstones-repository';
import { syncBackupsRepository } from '@/infrastructure/db/sync-backups-repository';
import { DexieEngineAnalysisCache } from '@/infrastructure/db/engine-cache-repository';
import type { ByteTransform } from './gzip';
import { syncCollectionsGateway } from './snapshot';
import { SyncService, type SyncServiceOptions } from './sync-service';
import { SyncProviderError, type SyncProvider, type SyncProviderUploadOptions } from './types';

const identity: ByteTransform = async (bytes) => bytes;
const FIXED_NOW = 1_700_000_000_000;

/** An in-memory `SyncProvider` over a single remote file (no network). */
class FakeProvider implements SyncProvider {
  readonly id = 'dropbox' as const;
  readonly label = 'Fake Dropbox';

  configured = true;
  connected = true;
  /** When true, every rev-based update fails with a 409. */
  failUpdates = false;
  readonly uploads: { rev: string | null; bytes: Uint8Array }[] = [];

  private bytes: Uint8Array | null = null;
  private revCounter = 0;
  private currentRev = 'rev-0';

  isConfigured(): boolean {
    return this.configured;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  async beginConnect(): Promise<void> {}

  async completeConnect(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMetadata(): Promise<RemoteFileMetadata | null> {
    if (this.bytes === null) {
      return null;
    }
    return {
      rev: this.currentRev,
      contentHash: await dropboxContentHash(this.bytes),
      size: this.bytes.byteLength,
      serverModified: '2024-01-01T00:00:00.000Z',
    };
  }

  async download(): Promise<Uint8Array> {
    if (this.bytes === null) {
      throw new SyncProviderError('http', 'No remote file.');
    }
    return this.bytes;
  }

  async upload(bytes: Uint8Array, opts: SyncProviderUploadOptions): Promise<RemoteFileMetadata> {
    this.uploads.push({ rev: opts.rev, bytes });
    if (opts.rev !== null) {
      if (this.failUpdates) {
        throw new SyncProviderError('conflict', 'Simulated 409.');
      }
      if (opts.rev !== this.currentRev) {
        throw new SyncProviderError('conflict', 'Stale rev.');
      }
    }
    this.revCounter += 1;
    this.currentRev = `rev-${this.revCounter}`;
    this.bytes = bytes;
    return {
      rev: this.currentRev,
      contentHash: await dropboxContentHash(bytes),
      size: bytes.byteLength,
      serverModified: '2024-01-01T00:00:00.000Z',
    };
  }

  /** Replace the remote file with a serialized envelope (another device). */
  async setRemote(envelope: SyncEnvelopeV1): Promise<void> {
    this.revCounter += 1;
    this.currentRev = `rev-${this.revCounter}`;
    this.bytes = new TextEncoder().encode(serializeEnvelope(envelope));
  }

  get remoteBytes(): Uint8Array | null {
    return this.bytes;
  }
}

function gameRow(id: string, updatedAt: number): GameRow {
  return {
    id,
    source: 'chesscom',
    externalId: null,
    playedAt: null,
    whitePlayer: { name: 'White', rating: null },
    blackPlayer: { name: 'Black', rating: null },
    result: '*',
    timeControl: '180+2',
    normalizedTimeControl: 'bullet',
    userColor: 'white',
    pgn: '1. e4 e5 *',
    importedAt: updatedAt,
    updatedAt,
  };
}

function makeEnvelope(
  overrides: Partial<SyncEnvelopeCollectionsV1> = {},
  deviceId = 'remote-device',
): SyncEnvelopeV1 {
  return {
    version: 1,
    exportedAt: '2024-01-01T00:00:00.000Z',
    deviceId,
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

function makeService(
  provider: SyncProvider,
  overrides: Partial<SyncServiceOptions> = {},
): SyncService {
  return new SyncService({
    provider,
    gateway: syncCollectionsGateway,
    syncState: syncStateRepository,
    tombstones: tombstonesRepository,
    backups: syncBackupsRepository,
    gzip: identity,
    gunzip: identity,
    now: () => FIXED_NOW,
    ...overrides,
  });
}

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

describe('SyncService', () => {
  beforeEach(clearAll);

  it('creates the remote file on the first sync and records the hashes', async () => {
    await gamesRepository.saveGame(fixtureGame('cc-blitz-clean'));
    const provider = new FakeProvider();
    const service = makeService(provider);

    const result = await service.syncNow();

    expect(result.outcome).toBe('created');
    expect(result.status).toBe('idle');
    expect(result.uploadedBytes).toBeGreaterThan(0);
    expect(provider.uploads).toHaveLength(1);
    expect(provider.uploads[0]?.rev).toBeNull();
    expect(await syncStateRepository.get<string>(SYNC_STATE_KEYS.lastPushedHash)).toBeTruthy();
    expect(
      await syncStateRepository.get<string>(SYNC_STATE_KEYS.lastRemoteContentHash),
    ).toBeTruthy();
    expect(await syncStateRepository.get<number>(SYNC_STATE_KEYS.lastSyncedAt)).toBe(FIXED_NOW);
  });

  it('is a no-op when neither side changed', async () => {
    await gamesRepository.saveGame(fixtureGame('cc-blitz-clean'));
    const provider = new FakeProvider();
    const service = makeService(provider);

    await service.syncNow();
    const uploadsAfterCreate = provider.uploads.length;

    const result = await service.syncNow();

    expect(result.outcome).toBe('up-to-date');
    expect(provider.uploads).toHaveLength(uploadsAfterCreate);
    expect(await syncStateRepository.get<boolean>(SYNC_STATE_KEYS.pending)).toBe(false);
  });

  it('pushes only when the local side changed', async () => {
    await gamesRepository.saveGame(fixtureGame('cc-blitz-clean'));
    const provider = new FakeProvider();
    const service = makeService(provider);
    await service.syncNow();

    const added = fixtureGame('li-rapid-clean');
    await gamesRepository.saveGame(added);

    const result = await service.syncNow();

    expect(result.outcome).toBe('pushed');
    expect(provider.uploads.at(-1)?.rev).not.toBeNull();
  });

  it('pulls only when the remote side changed, without uploading', async () => {
    await gamesRepository.saveGame(fixtureGame('cc-blitz-clean'));
    const provider = new FakeProvider();
    const service = makeService(provider);
    await service.syncNow();
    const uploadsAfterCreate = provider.uploads.length;

    await provider.setRemote(makeEnvelope({ games: [gameRow('remote-game', 1000)] }));

    const result = await service.syncNow();

    expect(result.outcome).toBe('pulled');
    expect(provider.uploads).toHaveLength(uploadsAfterCreate);
    expect(await db.games.get('remote-game')).toBeDefined();
  });

  it('merges both changes and uploads the union', async () => {
    await gamesRepository.saveGame(fixtureGame('cc-blitz-clean'));
    const provider = new FakeProvider();
    const service = makeService(provider);
    await service.syncNow();

    const added = fixtureGame('li-rapid-clean');
    await gamesRepository.saveGame(added);
    await provider.setRemote(makeEnvelope({ games: [gameRow('remote-game', 1000)] }));

    const result = await service.syncNow();

    expect(result.outcome).toBe('merged');
    expect(await db.games.get('remote-game')).toBeDefined();
    expect(await db.games.get(added.id)).toBeDefined();

    const remote = parseEnvelope(new TextDecoder().decode(provider.remoteBytes!));
    const ids = remote.collections.games.map((game) => game.id).sort();
    expect(ids).toEqual([fixtureGame('cc-blitz-clean').id, 'remote-game', added.id].sort());
  });

  it('retries 409, then backs up the remote payload and uploads as a new file', async () => {
    await gamesRepository.saveGame(fixtureGame('cc-blitz-clean'));
    const provider = new FakeProvider();
    const service = makeService(provider);
    await service.syncNow();

    await gamesRepository.saveGame(fixtureGame('li-rapid-clean'));
    await provider.setRemote(makeEnvelope({ games: [gameRow('remote-game', 1000)] }));
    provider.failUpdates = true;

    const result = await service.syncNow();

    expect(result.outcome).toBe('conflict-backup');
    expect(result.status).toBe('conflict');
    expect(result.backupId).not.toBeNull();
    const backup = await syncBackupsRepository.get(result.backupId!);
    expect(backup?.meta?.reason).toBe('conflict-exhausted');
    expect(backup?.meta?.rev).toBeDefined();
    expect(provider.uploads.at(-1)?.rev).toBeNull();
  });

  it('reports offline without touching the provider', async () => {
    const provider = new FakeProvider();
    const service = makeService(provider, { isOnline: () => false });
    const seen: SyncStatus[] = [];
    const unsubscribe = service.subscribe((snapshot) => seen.push(snapshot.status));

    const result = await service.syncNow();

    expect(result.outcome).toBe('offline');
    expect(result.status).toBe('offline');
    expect(seen).toContain('offline');
    expect(provider.uploads).toHaveLength(0);
    unsubscribe();
  });

  it('applies a remote game tombstone through the cascade and leaves the engine cache intact', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const job = makeJob(game.id, 2);
    await analysisJobsRepository.putJob(job);
    await analysesRepository.replaceAnalysis(makeRecords(game.id, job.id, 2));
    const cache = new DexieEngineAnalysisCache();
    await cache.put('shared-fen-key', engineResult());

    const provider = new FakeProvider();
    const service = makeService(provider);
    await service.syncNow();

    const tombstone = makeTombstone('game', game.id, Date.now() + 10_000, 'remote-device');
    await provider.setRemote(makeEnvelope({ tombstones: [tombstone] }));

    const result = await service.syncNow();

    expect(result.outcome).toBe('pulled');
    expect(await db.games.get(game.id)).toBeUndefined();
    expect(await db.analyses.count()).toBe(0);
    expect(await db.analysisJobs.count()).toBe(0);
    expect(await db.syncTombstones.get(tombstone.id)).toBeDefined();
    expect(await cache.count()).toBe(1);
  });

  it('exports and imports a backup round-trip with no provider configured', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const provider = new FakeProvider();
    provider.configured = false;
    const service = makeService(provider);

    const { bytes, fileName } = await service.exportBackup();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(fileName).toMatch(/^chessremedy-backup-.*\.json\.gz$/);

    await db.games.clear();
    expect(await db.games.count()).toBe(0);

    const result = await service.importBackup(bytes);

    expect(result).toEqual({ merged: true });
    expect(await db.games.get(game.id)).toBeDefined();
  });

  it('imports through the canonical path so a tombstone still wins', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const provider = new FakeProvider();
    provider.configured = false;
    const service = makeService(provider);

    const tombstone = makeTombstone('game', game.id, Date.now() + 10_000, 'other-device');
    const bytes = new TextEncoder().encode(
      serializeEnvelope(makeEnvelope({ tombstones: [tombstone] })),
    );

    await service.importBackup(bytes);

    expect(await db.games.get(game.id)).toBeUndefined();
    expect(await db.syncTombstones.get(tombstone.id)).toBeDefined();
  });

  it('surfaces a provider failure as an error status without throwing', async () => {
    const provider = new FakeProvider();
    provider.getMetadata = async () => {
      throw new SyncProviderError('network', 'network down');
    };
    const service = makeService(provider);

    const result = await service.syncNow();

    expect(result.outcome).toBe('offline');
    expect(result.status).toBe('offline');
    expect(result.error?.code).toBe('network');
  });

  it('coalesces concurrent syncNow calls into one round', async () => {
    await gamesRepository.saveGame(fixtureGame('cc-blitz-clean'));
    const provider = new FakeProvider();
    const service = makeService(provider);

    const [first, second] = await Promise.all([service.syncNow(), service.syncNow()]);

    expect(first).toBe(second);
    expect(provider.uploads).toHaveLength(1);
  });
});
