// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  SYNC_STATE_KEYS,
  type SyncStateRepository,
} from '@/infrastructure/db/sync-state-repository';
import {
  DROPBOX_TOKEN_URL,
  DropboxAuthStore,
  base64UrlEncode,
  buildAuthorizeUrl,
  codeChallengeS256,
  createCodeVerifier,
  exchangeCode,
  refreshToken,
  type DropboxSessionStore,
} from './dropboxAuth';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  globalThis.fetch(input, init);

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

function createFakeSession(): DropboxSessionStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('Dropbox PKCE (ADR-015)', () => {
  it('derives a matching S256 challenge from a base64url verifier', async () => {
    const verifier = createCodeVerifier(() => new Uint8Array(64).fill(7));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).not.toContain('=');

    const challenge = await codeChallengeS256(verifier);
    const expected = base64UrlEncode(
      new Uint8Array(
        await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
      ),
    );
    expect(challenge).toBe(expected);
  });

  it('builds an authorize URL with offline access and the S256 challenge', () => {
    const url = new URL(
      buildAuthorizeUrl({
        appKey: 'app-key',
        redirectUri: 'https://app.example/settings',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('app-key');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/settings');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.search).not.toContain('client_secret');
  });

  it('exchanges a code with Basic app-key auth and no client secret', async () => {
    server.use(
      http.post(DROPBOX_TOKEN_URL, async ({ request }) => {
        const body = await request.text();
        const params = new URLSearchParams(body);
        expect(params.get('grant_type')).toBe('authorization_code');
        expect(params.get('code')).toBe('auth-code');
        expect(params.get('code_verifier')).toBe('verifier-1');
        expect(body).not.toContain('client_secret');
        expect(request.headers.get('authorization')).toBe(`Basic ${btoa('app-key:')}`);
        return HttpResponse.json({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'bearer',
        });
      }),
    );

    const tokens = await exchangeCode({
      appKey: 'app-key',
      code: 'auth-code',
      codeVerifier: 'verifier-1',
      fetchImpl,
      now: () => 1_000,
    });

    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_000 + 3_600_000,
    });
  });

  it('surfaces the Dropbox error description when the token request is rejected', async () => {
    server.use(
      http.post(DROPBOX_TOKEN_URL, () =>
        HttpResponse.json(
          { error: 'invalid_grant', error_description: 'code has already been used' },
          { status: 400 },
        ),
      ),
    );

    await expect(
      exchangeCode({
        appKey: 'app-key',
        code: 'auth-code',
        codeVerifier: 'verifier-1',
        fetchImpl,
      }),
    ).rejects.toThrow('Dropbox token request failed with HTTP 400: code has already been used');
  });

  it('refreshes a token and keeps the existing refresh token when omitted', async () => {
    server.use(
      http.post(DROPBOX_TOKEN_URL, async ({ request }) => {
        const body = await request.text();
        const params = new URLSearchParams(body);
        expect(params.get('grant_type')).toBe('refresh_token');
        expect(params.get('refresh_token')).toBe('refresh-1');
        expect(body).not.toContain('client_secret');
        expect(request.headers.get('authorization')).toBe(`Basic ${btoa('app-key:')}`);
        return HttpResponse.json({ access_token: 'access-2', expires_in: 7200 });
      }),
    );

    const tokens = await refreshToken({
      appKey: 'app-key',
      refreshToken: 'refresh-1',
      fetchImpl,
      now: () => 2_000,
    });

    expect(tokens).toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      expiresAt: 2_000 + 7_200_000,
    });
  });

  it('persists tokens to syncState during completeConnect and clears the verifier', async () => {
    const syncState = createFakeSyncState();
    const session = createFakeSession();
    const navigate = vi.fn();
    server.use(
      http.post(DROPBOX_TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'access-9',
          refresh_token: 'refresh-9',
          expires_in: 3600,
        }),
      ),
    );

    const store = new DropboxAuthStore({
      appKey: 'app-key',
      syncState,
      fetchImpl,
      now: () => 1_000,
      randomBytes: (length) => new Uint8Array(length).fill(3),
      session,
      navigate,
    });

    await store.beginConnect('https://app.example/settings');

    const authorizeUrl = new URL(navigate.mock.calls[0]?.[0] as string);
    const state = authorizeUrl.searchParams.get('state') as string;
    expect(state.length).toBeGreaterThan(0);
    expect(session.getItem('chessremedy:dropbox:pkce')).not.toBeNull();

    await store.completeConnect(new URLSearchParams({ code: 'auth-code', state }));

    await expect(syncState.get<string>(SYNC_STATE_KEYS.accessToken)).resolves.toBe('access-9');
    await expect(syncState.get<string>(SYNC_STATE_KEYS.refreshToken)).resolves.toBe('refresh-9');
    await expect(syncState.get<number>(SYNC_STATE_KEYS.tokenExpiresAt)).resolves.toBe(
      1_000 + 3_600_000,
    );
    expect(session.getItem('chessremedy:dropbox:pkce')).toBeNull();
    await expect(store.isConnected()).resolves.toBe(true);
  });

  it('rejects a callback whose OAuth state does not match', async () => {
    const store = new DropboxAuthStore({
      appKey: 'app-key',
      syncState: createFakeSyncState(),
      fetchImpl,
      session: createFakeSession(),
      navigate: () => {},
    });

    await expect(
      store.completeConnect(new URLSearchParams({ code: 'auth-code', state: 'wrong' })),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('refreshes an expired token from the stored refresh token', async () => {
    const syncState = createFakeSyncState({
      [SYNC_STATE_KEYS.accessToken]: 'stale-access',
      [SYNC_STATE_KEYS.refreshToken]: 'refresh-1',
      [SYNC_STATE_KEYS.tokenExpiresAt]: 1_000,
    });
    server.use(
      http.post(DROPBOX_TOKEN_URL, () =>
        HttpResponse.json({ access_token: 'access-fresh', expires_in: 3600 }),
      ),
    );
    const store = new DropboxAuthStore({
      appKey: 'app-key',
      syncState,
      fetchImpl,
      now: () => 2_000,
    });

    const tokens = await store.ensureFreshTokens();

    expect(tokens).toEqual({
      accessToken: 'access-fresh',
      refreshToken: 'refresh-1',
      expiresAt: 2_000 + 3_600_000,
    });
    await expect(syncState.get<string>(SYNC_STATE_KEYS.accessToken)).resolves.toBe('access-fresh');
  });
});
