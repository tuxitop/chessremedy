/**
 * Feature 016 — Dropbox OAuth2 PKCE (infrastructure).
 *
 * ChessRemedy is a browser-only, local-first SPA: it has no backend to hold a
 * client secret, so Dropbox authorization uses the PKCE flow (RFC 7636). The
 * public `VITE_DROPBOX_APP_KEY` identifies the app; the `code_verifier` never
 * leaves the device and the `S256` challenge is derived with Web Crypto
 * (ADR-015). `token_access_type=offline` yields a refresh token so the app can
 * stay connected without re-prompting.
 *
 * Tokens are persisted in the **non-synced** `syncState` IndexedDB table via
 * the injected `SyncStateRepository`; they never enter `settings` or the sync
 * envelope (ADR-015). The `code_verifier`/`state` pair is kept in
 * `sessionStorage` for the single round-trip that needs it.
 *
 * Everything network- or clock-dependent is injectable (`FetchLike`, `now`,
 * `randomBytes`, `digest`, `session`, `navigate`) so the flow is deterministic
 * under Node + MSW.
 */

import {
  SYNC_STATE_KEYS,
  type SyncStateRepository,
} from '@/infrastructure/db/sync-state-repository';
import type { FetchLike } from '@/infrastructure/providers/transport';
import { SyncProviderError } from '../types';

/** Dropbox authorization endpoint (no client secret required for PKCE). */
export const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';

/** Dropbox token endpoint for code exchange and refresh. */
export const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

/** Session-storage key holding the in-flight PKCE verifier/state. */
export const DROPBOX_PKCE_STORAGE_KEY = 'chessremedy:dropbox:pkce';

/** Refresh an access token this long before it actually expires. */
export const DROPBOX_TOKEN_EXPIRY_BUFFER_MS = 60_000;

/** A PKCE verifier plus its derived S256 challenge. */
export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

/** The token set persisted in `syncState`. `expiresAt` is epoch millis. */
export interface DropboxTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

/** Source of cryptographically random bytes (injectable for tests). */
export type RandomBytesFn = (length: number) => Uint8Array;

/** SHA-256 digest over bytes, returning the raw 32-byte digest. */
export type PkceDigestFn = (data: Uint8Array) => Promise<Uint8Array>;

/** The minimal `sessionStorage` surface the PKCE handshake needs. */
export interface DropboxSessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const textEncoder = new TextEncoder();

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

async function defaultDigest(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('Web Crypto (crypto.subtle) is not available in this environment.');
  }
  // Copy into an ArrayBuffer-backed view so the argument satisfies BufferSource.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Uint8Array(await subtle.digest('SHA-256', copy));
}

/** Base64url-encode bytes without padding (RFC 4648 §5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A 64-byte random verifier rendered as an unpadded base64url string. */
export function createCodeVerifier(randomBytes: RandomBytesFn = defaultRandomBytes): string {
  return base64UrlEncode(randomBytes(64));
}

/** The `S256` challenge for `codeVerifier` (base64url of its SHA-256 digest). */
export async function codeChallengeS256(
  codeVerifier: string,
  digest: PkceDigestFn = defaultDigest,
): Promise<string> {
  return base64UrlEncode(await digest(textEncoder.encode(codeVerifier)));
}

/** Generate a fresh verifier + challenge pair. */
export async function createPkcePair(
  randomBytes: RandomBytesFn = defaultRandomBytes,
  digest: PkceDigestFn = defaultDigest,
): Promise<PkcePair> {
  const codeVerifier = createCodeVerifier(randomBytes);
  return { codeVerifier, codeChallenge: await codeChallengeS256(codeVerifier, digest) };
}

/** Parameters of the Dropbox authorization URL. */
export interface AuthorizeUrlParams {
  readonly appKey: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}

/**
 * Build the authorization URL. Requests `token_access_type=offline` so the
 * exchange returns a refresh token, and supplies the `S256` challenge. The app
 * key travels as `client_id`; no secret is ever included.
 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(DROPBOX_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.appKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('token_access_type', 'offline');
  url.searchParams.set('state', params.state);
  return url.toString();
}

function basicAuthHeader(appKey: string): string {
  return `Basic ${btoa(`${appKey}:`)}`;
}

interface TokenEndpointOptions {
  readonly appKey: string;
  readonly fetchImpl: FetchLike;
  readonly now?: () => number;
}

export interface ExchangeCodeParams extends TokenEndpointOptions {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri?: string;
}

export interface RefreshTokenParams extends TokenEndpointOptions {
  readonly refreshToken: string;
}

function parseTokenResponse(
  body: unknown,
  now: () => number,
  fallbackRefreshToken?: string,
): DropboxTokens {
  if (typeof body !== 'object' || body === null) {
    throw new SyncProviderError('invalid-response', 'Dropbox returned a malformed token response.');
  }
  const record = body as Record<string, unknown>;
  const accessToken = record.access_token;
  const refreshToken = record.refresh_token ?? fallbackRefreshToken;
  const expiresIn = record.expires_in;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new SyncProviderError(
      'invalid-response',
      'Dropbox token response is missing access_token.',
    );
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new SyncProviderError(
      'invalid-response',
      'Dropbox token response is missing refresh_token; was token_access_type=offline requested?',
    );
  }
  const seconds = typeof expiresIn === 'number' ? expiresIn : Number(expiresIn);
  const ttlSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 14_400;
  return { accessToken, refreshToken, expiresAt: now() + ttlSeconds * 1000 };
}

async function postToken(body: URLSearchParams, options: TokenEndpointOptions): Promise<unknown> {
  const response = await options.fetchImpl(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(options.appKey),
    },
    body: body.toString(),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    throw new SyncProviderError(
      response.status === 401 || response.status === 403 ? 'auth' : 'http',
      `Dropbox token request failed with HTTP ${response.status}${describeTokenError(parsed)}.`,
    );
  }
  return parsed;
}

/** Render Dropbox's `error`/`error_description` for a failed token response. */
function describeTokenError(parsed: unknown): string {
  if (parsed === null || typeof parsed !== 'object') {
    return '';
  }
  const record = parsed as Record<string, unknown>;
  const description = record.error_description;
  if (typeof description === 'string' && description.length > 0) {
    return `: ${description}`;
  }
  const code = record.error;
  if (typeof code === 'string' && code.length > 0) {
    return ` (${code})`;
  }
  return '';
}

/** Exchange an authorization code for an offline (refreshable) token set. */
export async function exchangeCode(params: ExchangeCodeParams): Promise<DropboxTokens> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', params.code);
  body.set('code_verifier', params.codeVerifier);
  if (params.redirectUri !== undefined) {
    body.set('redirect_uri', params.redirectUri);
  }
  return parseTokenResponse(await postToken(body, params), params.now ?? Date.now);
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshToken(params: RefreshTokenParams): Promise<DropboxTokens> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', params.refreshToken);
  return parseTokenResponse(
    await postToken(body, params),
    params.now ?? Date.now,
    params.refreshToken,
  );
}

interface StoredPkce {
  readonly codeVerifier: string;
  readonly state: string;
  readonly redirectUri: string;
}

function defaultSessionStore(): DropboxSessionStore {
  const storage = globalThis.sessionStorage;
  if (storage !== undefined) {
    return storage;
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

function defaultNavigate(url: string): void {
  globalThis.location.assign(url);
}

export interface DropboxAuthStoreOptions {
  /** Public Dropbox app key (`VITE_DROPBOX_APP_KEY`). */
  readonly appKey?: string;
  readonly syncState: SyncStateRepository;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  readonly randomBytes?: RandomBytesFn;
  readonly digest?: PkceDigestFn;
  readonly session?: DropboxSessionStore;
  readonly navigate?: (url: string) => void;
}

/**
 * Owns the Dropbox credential lifecycle: PKCE handshake, token persistence in
 * `syncState`, proactive refresh and disconnect. The provider delegates its
 * `SyncProvider` connection methods here.
 */
export class DropboxAuthStore {
  private readonly appKey: string | undefined;
  private readonly syncState: SyncStateRepository;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly randomBytes: RandomBytesFn;
  private readonly digest: PkceDigestFn;
  private readonly session: DropboxSessionStore;
  private readonly navigate: (url: string) => void;

  constructor(options: DropboxAuthStoreOptions) {
    this.appKey = options.appKey;
    this.syncState = options.syncState;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? defaultRandomBytes;
    this.digest = options.digest ?? defaultDigest;
    this.session = options.session ?? defaultSessionStore();
    this.navigate = options.navigate ?? defaultNavigate;
  }

  /** Whether the build has an app key at all. */
  isConfigured(): boolean {
    return typeof this.appKey === 'string' && this.appKey.length > 0;
  }

  /** Whether a refresh token is stored. */
  async isConnected(): Promise<boolean> {
    return (await this.getTokens()) !== null;
  }

  /** The persisted token set, or `null` when not connected. */
  async getTokens(): Promise<DropboxTokens | null> {
    const [accessToken, refreshToken, expiresAt] = await Promise.all([
      this.syncState.get<string>(SYNC_STATE_KEYS.accessToken),
      this.syncState.get<string>(SYNC_STATE_KEYS.refreshToken),
      this.syncState.get<number>(SYNC_STATE_KEYS.tokenExpiresAt),
    ]);
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return null;
    }
    return {
      accessToken: typeof accessToken === 'string' ? accessToken : '',
      refreshToken,
      expiresAt: typeof expiresAt === 'number' ? expiresAt : 0,
    };
  }

  /** Start the PKCE redirect: store the verifier and navigate to Dropbox. */
  async beginConnect(redirectUri: string): Promise<void> {
    const appKey = this.requireAppKey();
    const { codeVerifier, codeChallenge } = await createPkcePair(this.randomBytes, this.digest);
    const state = base64UrlEncode(this.randomBytes(16));
    const stored: StoredPkce = { codeVerifier, state, redirectUri };
    this.session.setItem(DROPBOX_PKCE_STORAGE_KEY, JSON.stringify(stored));
    this.navigate(buildAuthorizeUrl({ appKey, redirectUri, state, codeChallenge }));
  }

  /** Complete the callback: verify `state`, exchange the code, persist tokens. */
  async completeConnect(callback: URLSearchParams): Promise<void> {
    const appKey = this.requireAppKey();
    const error = callback.get('error');
    if (error !== null && error.length > 0) {
      throw new SyncProviderError('auth', `Dropbox authorization failed: ${error}.`);
    }
    const code = callback.get('code');
    if (code === null || code.length === 0) {
      throw new SyncProviderError('auth', 'The Dropbox callback is missing an authorization code.');
    }
    const stored = this.readPkce();
    const state = callback.get('state');
    if (stored === null || (state !== null && state !== stored.state)) {
      throw new SyncProviderError(
        'auth',
        'The Dropbox OAuth state did not match; restart the connection.',
      );
    }
    const tokens = await exchangeCode({
      appKey,
      code,
      codeVerifier: stored.codeVerifier,
      redirectUri: stored.redirectUri,
      fetchImpl: this.fetchImpl,
      now: this.now,
    });
    await this.persistTokens(tokens);
    this.session.removeItem(DROPBOX_PKCE_STORAGE_KEY);
  }

  /** Return a non-expired token set, refreshing proactively when needed. */
  async ensureFreshTokens(): Promise<DropboxTokens | null> {
    const tokens = await this.getTokens();
    if (tokens === null) {
      return null;
    }
    if (tokens.expiresAt - this.now() > DROPBOX_TOKEN_EXPIRY_BUFFER_MS) {
      return tokens;
    }
    if (!this.isConfigured()) {
      return tokens;
    }
    const refreshed = await refreshToken({
      appKey: this.appKey as string,
      refreshToken: tokens.refreshToken,
      fetchImpl: this.fetchImpl,
      now: this.now,
    });
    await this.persistTokens(refreshed);
    return refreshed;
  }

  /** Forget the stored credentials (local data is untouched). */
  async disconnect(): Promise<void> {
    this.session.removeItem(DROPBOX_PKCE_STORAGE_KEY);
    await Promise.all([
      this.syncState.remove(SYNC_STATE_KEYS.accessToken),
      this.syncState.remove(SYNC_STATE_KEYS.refreshToken),
      this.syncState.remove(SYNC_STATE_KEYS.tokenExpiresAt),
      this.syncState.remove(SYNC_STATE_KEYS.provider),
    ]);
  }

  private async persistTokens(tokens: DropboxTokens): Promise<void> {
    await Promise.all([
      this.syncState.set(SYNC_STATE_KEYS.accessToken, tokens.accessToken),
      this.syncState.set(SYNC_STATE_KEYS.refreshToken, tokens.refreshToken),
      this.syncState.set(SYNC_STATE_KEYS.tokenExpiresAt, tokens.expiresAt),
      this.syncState.set(SYNC_STATE_KEYS.provider, 'dropbox'),
    ]);
  }

  private readPkce(): StoredPkce | null {
    const raw = this.session.getItem(DROPBOX_PKCE_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredPkce>;
      if (
        typeof parsed.codeVerifier === 'string' &&
        typeof parsed.state === 'string' &&
        typeof parsed.redirectUri === 'string'
      ) {
        return {
          codeVerifier: parsed.codeVerifier,
          state: parsed.state,
          redirectUri: parsed.redirectUri,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  private requireAppKey(): string {
    if (!this.isConfigured()) {
      throw new SyncProviderError('auth', 'VITE_DROPBOX_APP_KEY is not configured.');
    }
    return this.appKey as string;
  }
}
