/**
 * Feature 016 — Dropbox `SyncProvider` (infrastructure).
 *
 * The first concrete adapter behind the provider-independent `SyncProvider`
 * boundary (ADR-008). It composes the PKCE credential store
 * (`dropboxAuth`) and the SDK client (`dropboxClient`) and exposes only the
 * opaque operations the sync engine needs. `rev`/`content_hash` never escape
 * this module (ADR-017).
 *
 * The app key is public configuration (`VITE_DROPBOX_APP_KEY`); there is no
 * client secret. Tokens live in the non-synced `syncState` table.
 */

import type { SyncStateRepository } from '@/infrastructure/db/sync-state-repository';
import type { FetchLike } from '@/infrastructure/providers/transport';
import {
  SyncProviderError,
  type RemoteBackupInfo,
  type RemoteFileMetadata,
  type SyncProvider,
  type SyncProviderUploadOptions,
} from '../types';
import {
  DropboxAuthStore,
  type DropboxSessionStore,
  type PkceDigestFn,
  type RandomBytesFn,
} from './dropboxAuth';
import {
  DROPBOX_MAX_ATTEMPTS,
  DropboxClient,
  DROPBOX_SYNC_PATH,
  dropboxRetryDelayMs,
} from './dropboxClient';

/** Public app key from the Vite environment, or `undefined` when unset. */
export function readDropboxAppKey(): string | undefined {
  const value = import.meta.env.VITE_DROPBOX_APP_KEY;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export interface DropboxProviderOptions {
  /** Public Dropbox app key. When absent the provider is "not configured". */
  readonly appKey?: string;
  /** Non-synced token/bookkeeping store (injected for tests). */
  readonly syncState: SyncStateRepository;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  readonly session?: DropboxSessionStore;
  readonly navigate?: (url: string) => void;
  readonly randomBytes?: RandomBytesFn;
  readonly digest?: PkceDigestFn;
  /** Override the sync file path (tests only). */
  readonly path?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: (attempt: number) => number;
}

/** The V1 Dropbox adapter (ADR-015). */
export class DropboxProvider implements SyncProvider {
  readonly id = 'dropbox' as const;
  readonly label = 'Dropbox';

  private readonly appKey: string | undefined;
  private readonly auth: DropboxAuthStore;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly path: string;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;

  constructor(options: DropboxProviderOptions) {
    this.appKey = options.appKey;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.path = options.path ?? DROPBOX_SYNC_PATH;
    this.maxAttempts = options.maxAttempts ?? DROPBOX_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? dropboxRetryDelayMs;
    this.auth = new DropboxAuthStore({
      ...(options.appKey !== undefined ? { appKey: options.appKey } : {}),
      syncState: options.syncState,
      fetchImpl: this.fetchImpl,
      now: this.now,
      ...(options.session !== undefined ? { session: options.session } : {}),
      ...(options.navigate !== undefined ? { navigate: options.navigate } : {}),
      ...(options.randomBytes !== undefined ? { randomBytes: options.randomBytes } : {}),
      ...(options.digest !== undefined ? { digest: options.digest } : {}),
    });
  }

  isConfigured(): boolean {
    return this.auth.isConfigured();
  }

  isConnected(): Promise<boolean> {
    return this.auth.isConnected();
  }

  beginConnect(redirectUri: string): Promise<void> {
    return this.auth.beginConnect(redirectUri);
  }

  completeConnect(callback: URLSearchParams): Promise<void> {
    return this.auth.completeConnect(callback);
  }

  disconnect(): Promise<void> {
    return this.auth.disconnect();
  }

  async getMetadata(): Promise<RemoteFileMetadata | null> {
    return (await this.client()).getMetadata();
  }

  async download(): Promise<Uint8Array> {
    return (await this.client()).download();
  }

  async upload(bytes: Uint8Array, options: SyncProviderUploadOptions): Promise<RemoteFileMetadata> {
    return (await this.client()).upload(bytes, options);
  }

  async listBackups(): Promise<RemoteBackupInfo[]> {
    return (await this.client()).listBackups();
  }

  private async client(): Promise<DropboxClient> {
    const appKey = this.appKey;
    if (typeof appKey !== 'string' || appKey.length === 0) {
      throw new SyncProviderError('auth', 'VITE_DROPBOX_APP_KEY is not configured.');
    }
    const tokens = await this.auth.ensureFreshTokens();
    if (tokens === null) {
      throw new SyncProviderError('auth', 'Dropbox is not connected.');
    }
    return new DropboxClient({
      clientId: appKey,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: new Date(tokens.expiresAt),
      fetchImpl: this.fetchImpl,
      path: this.path,
      maxAttempts: this.maxAttempts,
      retryDelayMs: this.retryDelayMs,
    });
  }
}
