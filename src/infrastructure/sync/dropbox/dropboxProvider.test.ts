// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  SYNC_STATE_KEYS,
  type SyncStateRepository,
} from '@/infrastructure/db/sync-state-repository';
import { DropboxProvider, type DropboxProviderOptions } from './dropboxProvider';
import { DROPBOX_BACKUP_DIR, DropboxClient } from './dropboxClient';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const API = 'https://api.dropboxapi.com';
const CONTENT = 'https://content.dropboxapi.com';
const GET_METADATA = `${API}/2/files/get_metadata`;
const DOWNLOAD = `${CONTENT}/2/files/download`;
const UPLOAD = `${CONTENT}/2/files/upload`;
const LIST_FOLDER = `${API}/2/files/list_folder`;

const fileMetadata = {
  '.tag': 'file',
  name: 'sync.json.gz',
  id: 'id:abc',
  rev: 'rev-1',
  size: 42,
  server_modified: '2024-01-01T00:00:00Z',
  content_hash: 'hash-1',
};

function createFakeSyncState(seed: Record<string, unknown> = {}): SyncStateRepository {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return store.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async patch<T extends object>(key: string, partial: Partial<T>): Promise<T | undefined> {
      const existing = store.get(key);
      if (existing === undefined) {
        return undefined;
      }
      const merged = { ...(existing as T), ...partial };
      store.set(key, merged);
      return merged;
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
    async clear(): Promise<void> {
      store.clear();
    },
    async getOrCreateDeviceId(): Promise<string> {
      return 'test-device';
    },
  };
}

function makeProvider(overrides: Partial<DropboxProviderOptions> = {}): DropboxProvider {
  const syncState = createFakeSyncState({
    [SYNC_STATE_KEYS.accessToken]: 'access-token',
    [SYNC_STATE_KEYS.refreshToken]: 'refresh-token',
    [SYNC_STATE_KEYS.tokenExpiresAt]: Date.now() + 3_600_000,
  });
  return new DropboxProvider({
    appKey: 'test-app-key',
    syncState,
    fetchImpl: globalThis.fetch.bind(globalThis),
    retryDelayMs: () => 0,
    ...overrides,
  });
}

describe('DropboxProvider (MSW, ADR-015/ADR-017)', () => {
  it('treats a missing remote file (404) as no remote', async () => {
    server.use(
      http.post(GET_METADATA, () =>
        HttpResponse.json(
          {
            error_summary: 'path/not_found/',
            error: { '.tag': 'path', path: { '.tag': 'not_found' } },
          },
          { status: 404 },
        ),
      ),
    );

    await expect(makeProvider().getMetadata()).resolves.toBeNull();
  });

  it('treats a Dropbox 409 path/not_found as no remote too', async () => {
    server.use(
      http.post(GET_METADATA, () =>
        HttpResponse.json(
          {
            error_summary: 'path/not_found/',
            error: { '.tag': 'path', path: { '.tag': 'not_found' } },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(makeProvider().getMetadata()).resolves.toBeNull();
  });

  it('downloads the raw gzipped bytes', async () => {
    const payload = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
    server.use(
      http.post(
        DOWNLOAD,
        () =>
          new HttpResponse(payload, {
            status: 200,
            headers: { 'dropbox-api-result': JSON.stringify(fileMetadata) },
          }),
      ),
    );

    const bytes = await makeProvider().download();
    expect([...bytes]).toEqual([...payload]);
  });

  it('uploads with mode.update and the supplied rev', async () => {
    const captured: Record<string, unknown>[] = [];
    server.use(
      http.post(UPLOAD, ({ request }) => {
        captured.push(
          JSON.parse(request.headers.get('dropbox-api-arg') ?? '{}') as Record<string, unknown>,
        );
        return HttpResponse.json({ ...fileMetadata, rev: 'rev-2' });
      }),
    );

    const metadata = await makeProvider().upload(new Uint8Array([1, 2, 3]), { rev: 'rev-1' });

    expect(captured[0]?.mode).toEqual({ '.tag': 'update', update: 'rev-1' });
    expect(captured[0]?.path).toBe('/Apps/ChessRemedy/sync.json.gz');
    expect(metadata.rev).toBe('rev-2');
  });

  it('creates the file with mode.add when no rev is supplied', async () => {
    const captured: Record<string, unknown>[] = [];
    server.use(
      http.post(UPLOAD, ({ request }) => {
        captured.push(
          JSON.parse(request.headers.get('dropbox-api-arg') ?? '{}') as Record<string, unknown>,
        );
        return HttpResponse.json({ ...fileMetadata, rev: 'rev-new' });
      }),
    );

    await makeProvider().upload(new Uint8Array([1]), { rev: null });

    expect(captured[0]?.mode).toEqual({ '.tag': 'add' });
  });

  it('maps HTTP 409 to conflict', async () => {
    server.use(
      http.post(UPLOAD, () =>
        HttpResponse.json(
          {
            error_summary: 'path/conflict/file/',
            error: { '.tag': 'path', reason: { '.tag': 'conflict' } },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(
      makeProvider().upload(new Uint8Array([1]), { rev: 'stale-rev' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('retries a 429 and succeeds on the next attempt', async () => {
    let calls = 0;
    server.use(
      http.post(GET_METADATA, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 429 })
          : HttpResponse.json(fileMetadata);
      }),
    );

    const metadata = await makeProvider().getMetadata();

    expect(calls).toBe(2);
    expect(metadata?.rev).toBe('rev-1');
  });

  it('maps metadata missing rev/content_hash to invalid-response', async () => {
    server.use(
      http.post(GET_METADATA, () =>
        HttpResponse.json({
          '.tag': 'file',
          name: 'sync.json.gz',
          id: 'id:abc',
          size: 42,
          server_modified: '2024-01-01T00:00:00Z',
        }),
      ),
    );

    await expect(makeProvider().getMetadata()).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });

  it('reports unconfigured and disconnected without an app key/tokens', async () => {
    const unconfigured = new DropboxProvider({
      syncState: createFakeSyncState(),
      fetchImpl: globalThis.fetch.bind(globalThis),
    });
    expect(unconfigured.isConfigured()).toBe(false);

    const disconnected = new DropboxProvider({
      appKey: 'test-app-key',
      syncState: createFakeSyncState(),
      fetchImpl: globalThis.fetch.bind(globalThis),
    });
    await expect(disconnected.isConnected()).resolves.toBe(false);
    await expect(disconnected.getMetadata()).rejects.toMatchObject({ code: 'auth' });
  });
});

function makeClient(): DropboxClient {
  return new DropboxClient({
    clientId: 'test-app-key',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    fetchImpl: globalThis.fetch.bind(globalThis),
    retryDelayMs: () => 0,
  });
}

describe('DropboxClient backups (ADR-017 step 4e)', () => {
  it('lists only timestamped backup files in the App Folder', async () => {
    server.use(
      http.post(LIST_FOLDER, async ({ request }) => {
        const args = (await request.json()) as { path?: string };
        expect(args.path).toBe(DROPBOX_BACKUP_DIR);
        return HttpResponse.json({
          entries: [
            {
              '.tag': 'file',
              name: 'sync.backup-2024-01-01T00:00:00.000Z.json.gz',
              id: 'id:backup',
              rev: 'rev-backup',
              size: 10,
              server_modified: '2024-01-01T00:00:00Z',
              content_hash: 'hash-backup',
            },
            {
              '.tag': 'file',
              name: 'notes.txt',
              id: 'id:notes',
              rev: 'rev-notes',
              size: 1,
              server_modified: '2024-01-01T00:00:00Z',
            },
            { '.tag': 'folder', name: 'nested', id: 'id:folder' },
          ],
          cursor: 'cursor-1',
          has_more: false,
        });
      }),
    );

    const backups = await makeClient().listBackups();

    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({
      id: 'id:backup',
      name: 'sync.backup-2024-01-01T00:00:00.000Z.json.gz',
      rev: 'rev-backup',
      contentHash: 'hash-backup',
    });
  });

  it('downloads a named backup and rejects a path-traversal name', async () => {
    const payload = new Uint8Array([9, 8, 7]);
    server.use(
      http.post(DOWNLOAD, ({ request }) => {
        const args = JSON.parse(request.headers.get('dropbox-api-arg') ?? '{}') as {
          path?: string;
        };
        expect(args.path).toBe(
          `${DROPBOX_BACKUP_DIR}/sync.backup-2024-01-01T00:00:00.000Z.json.gz`,
        );
        return new HttpResponse(payload, {
          status: 200,
          headers: { 'dropbox-api-result': JSON.stringify(fileMetadata) },
        });
      }),
    );

    const bytes = await makeClient().downloadBackup('sync.backup-2024-01-01T00:00:00.000Z.json.gz');
    expect([...bytes]).toEqual([...payload]);
    await expect(makeClient().downloadBackup('../sync.json.gz')).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });
});
