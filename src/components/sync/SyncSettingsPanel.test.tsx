import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  makeTombstone,
  serializeEnvelope,
  type SyncEnvelopeCollectionsV1,
  type SyncEnvelopeV1,
} from '@/domain/sync';
import { db } from '@/infrastructure/db/database';
import type { GameRow } from '@/infrastructure/db/games-repository';
import { syncBackupsRepository } from '@/infrastructure/db/sync-backups-repository';
import { syncStateRepository } from '@/infrastructure/db/sync-state-repository';
import { tombstonesRepository } from '@/infrastructure/db/tombstones-repository';
import { SyncService } from '@/infrastructure/sync/sync-service';
import { syncCollectionsGateway } from '@/infrastructure/sync/snapshot';
import type { SyncProvider, RemoteFileMetadata } from '@/infrastructure/sync/types';
import { renderWithProviders } from '@/test/test-utils';
import type { SyncDownloadFile } from '@/hooks/useSync';
import { SyncSettingsPanel } from './SyncSettingsPanel';
import { FakeSyncService } from './test-support';

// The default (no `service` prop) path: `useSync` resolves the browser service
// through a dynamic import. A hoisted holder lets a test provide the resolved
// service after the first render, exercising the lazy-load ordering.
const lazySync = vi.hoisted(() => ({ service: undefined as unknown }));
vi.mock('@/infrastructure/sync', () => ({
  getBrowserSyncService: () => lazySync.service,
}));

const FIXED_NOW = 1_700_000_000_000;

/** A provider that is always configured + connected (for the real engine). */
class AlwaysConnectedProvider implements SyncProvider {
  readonly id = 'dropbox' as const;
  readonly label = 'Dropbox';

  isConfigured(): boolean {
    return true;
  }

  async isConnected(): Promise<boolean> {
    return true;
  }

  async beginConnect(): Promise<void> {}

  async completeConnect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async getMetadata(): Promise<RemoteFileMetadata | null> {
    return null;
  }

  async download(): Promise<Uint8Array> {
    throw new Error('No remote file in this test.');
  }

  async upload(): Promise<RemoteFileMetadata> {
    throw new Error('Upload is not used in this test.');
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

function gzipEnvelope(envelope: SyncEnvelopeV1): Uint8Array {
  const json = serializeEnvelope(envelope);
  return new Uint8Array(gzipSync(Buffer.from(json, 'utf8')));
}

async function clearAll(): Promise<void> {
  await db.games.clear();
  await db.syncState.clear();
  await db.syncTombstones.clear();
  await db.syncBackups.clear();
}

describe('SyncSettingsPanel — connection states', () => {
  beforeEach(clearAll);
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('offers Connect Dropbox when configured but disconnected and connects', async () => {
    const service = new FakeSyncService({ configured: true, connected: false });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    const connect = await screen.findByTestId('sync-connect');
    expect(connect).toBeEnabled();
    const user = userEvent.setup();
    await user.click(connect);

    await waitFor(() => expect(service.connectCalls).toHaveLength(1));
    expect(await screen.findByTestId('sync-now')).toBeInTheDocument();
  });

  it('disables Connect and still offers local backup when the build is unconfigured', async () => {
    const service = new FakeSyncService({ configured: false, connected: false });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    expect(await screen.findByTestId('sync-connect')).toBeDisabled();
    expect(screen.getByTestId('sync-unconfigured')).toBeInTheDocument();
    expect(screen.getByTestId('sync-export-backup')).toBeInTheDocument();
    expect(screen.getByTestId('sync-import-input')).toBeInTheDocument();
  });

  it('shows the connected controls and runs Sync now', async () => {
    const service = new FakeSyncService({
      configured: true,
      connected: true,
      status: 'idle',
      lastSyncedAt: FIXED_NOW,
    });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    expect(await screen.findByTestId('sync-last-synced')).toHaveTextContent('Last synced');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sync-now'));
    await waitFor(() => expect(service.syncNowCalls.length).toBeGreaterThan(0));
  });

  it('disconnects and returns to the connect state', async () => {
    const service = new FakeSyncService({ configured: true, connected: true, status: 'idle' });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('sync-disconnect'));
    await waitFor(() => expect(screen.queryByTestId('sync-now')).not.toBeInTheDocument());
    expect(screen.getByTestId('sync-connect')).toBeInTheDocument();
  });

  it('surfaces the current error status', async () => {
    const service = new FakeSyncService({
      configured: true,
      connected: true,
      status: 'error',
      lastError: 'Upload failed.',
    });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    expect(await screen.findByTestId('sync-panel-error')).toHaveTextContent('Upload failed.');
    expect(await screen.findByTestId('sync-status-text')).toHaveTextContent('Sync error');
  });

  it('surfaces the conflict status', async () => {
    const service = new FakeSyncService({
      configured: true,
      connected: true,
      status: 'conflict',
      lastError: 'A backup was saved.',
    });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    expect(await screen.findByTestId('sync-status-text')).toHaveTextContent('Sync conflict');
    expect(screen.getByTestId('sync-panel-error')).toHaveTextContent('A backup was saved.');
  });
});

describe('SyncSettingsPanel — OAuth return', () => {
  beforeEach(async () => {
    await clearAll();
    window.history.replaceState({}, '', '/settings?code=abc&state=xyz');
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('completes the connection, cleans the URL and reports success', async () => {
    const service = new FakeSyncService({ configured: true, connected: false });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    expect(await screen.findByTestId('sync-oauth-success')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(service.completeConnectCalls[0]?.get('code')).toBe('abc');
    expect(service.completeConnectCalls[0]?.get('state')).toBe('xyz');
    expect(await screen.findByTestId('sync-now')).toBeInTheDocument();
  });

  it('reports a failed callback and still cleans the URL', async () => {
    const service = new FakeSyncService({
      configured: true,
      connected: false,
      completeConnectError: new Error('Bad code'),
    });
    renderWithProviders(<SyncSettingsPanel service={service} />);

    expect(await screen.findByTestId('sync-oauth-error')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('completes the callback when the sync service resolves lazily (regression)', async () => {
    // No `service` prop: the panel must wait for the dynamic import to resolve
    // before consuming `?code=`, otherwise the one-shot ref drops the callback.
    lazySync.service = new FakeSyncService({ configured: true, connected: false });
    renderWithProviders(<SyncSettingsPanel />);

    expect(await screen.findByTestId('sync-oauth-success')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''));
  });
});

describe('SyncSettingsPanel — local export/import (G4)', () => {
  beforeEach(clearAll);

  it('exports a downloadable gzip envelope with no provider configured', async () => {
    const bytes = gzipEnvelope(makeEnvelope());
    const service = new FakeSyncService({
      configured: false,
      connected: false,
      exportBytes: bytes,
      exportFileName: 'chessremedy-backup-test.json.gz',
    });
    const saveFile = vi.fn();
    renderWithProviders(<SyncSettingsPanel service={service} saveFile={saveFile} />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('sync-export-backup'));

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    const file = saveFile.mock.calls[0]![0] as SyncDownloadFile;
    expect(file.fileName).toBe('chessremedy-backup-test.json.gz');
    // gzip magic header proves it is a gzip envelope.
    expect(file.bytes[0]).toBe(0x1f);
    expect(file.bytes[1]).toBe(0x8b);
    const parsed = JSON.parse(gunzipSync(file.bytes).toString('utf8')) as { version: number };
    expect(parsed.version).toBe(1);
  });

  it('imports a chosen envelope and respects a tombstone', async () => {
    await db.games.put(gameRow('game-1', 1_000));
    const engine = new SyncService({
      provider: new AlwaysConnectedProvider(),
      gateway: syncCollectionsGateway,
      syncState: syncStateRepository,
      tombstones: tombstonesRepository,
      backups: syncBackupsRepository,
      gzip: async (bytes) => new Uint8Array(gzipSync(bytes)),
      gunzip: async (bytes) => new Uint8Array(gunzipSync(bytes)),
      now: () => FIXED_NOW,
    });
    const bytes = gzipEnvelope(
      makeEnvelope({ tombstones: [makeTombstone('game', 'game-1', 2_000, 'remote-device')] }),
    );
    const file = new File([bytes as BlobPart], 'backup.json.gz', { type: 'application/gzip' });
    const reload = vi.fn();
    const backups = {
      list: async () => [],
      get: async () => undefined,
    };
    renderWithProviders(<SyncSettingsPanel service={engine} backups={backups} reload={reload} />);

    const input = await screen.findByTestId('sync-import-input');
    const user = userEvent.setup();
    await user.upload(input, file);

    await waitFor(async () => {
      expect(await db.games.get('game-1')).toBeUndefined();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('sync-import-result')).toHaveTextContent('Backup imported');
  });

  it('restores a stored recovery backup and reloads', async () => {
    const payload = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
    const row = { id: 'backup-1', createdAt: FIXED_NOW, payload };
    const backups = {
      list: async () => [row],
      get: async (id: string) => (id === 'backup-1' ? row : undefined),
    };
    const service = new FakeSyncService({ configured: true, connected: true, status: 'idle' });
    const reload = vi.fn();
    renderWithProviders(<SyncSettingsPanel service={service} backups={backups} reload={reload} />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('sync-backup-restore-backup-1'));

    await waitFor(() => expect(service.imported).toHaveLength(1));
    expect(service.imported[0]).toBe(payload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
