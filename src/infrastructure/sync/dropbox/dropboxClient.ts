/**
 * Feature 016 — thin Dropbox SDK client (infrastructure).
 *
 * The official `dropbox` SDK is imported **only here** so the rest of the
 * application never depends on it (ADR-008 provider isolation). The client is
 * a thin typed wrapper that:
 *
 * - constructs the SDK with an injected `fetch` so MSW can intercept requests
 *   in Node tests (ADR-009);
 * - retries transient 429/5xx responses at the transport layer;
 * - maps SDK/HTTP failures to `SyncProviderError` codes (`conflict` on 409,
 *   `auth` on 401, `invalid-response` on missing metadata);
 * - keeps `rev`/`content_hash` inside the adapter (ADR-017).
 *
 * Sync path and backup naming are fixed by ADR-015/ADR-016 and live here, not
 * in `app-config`.
 */

import { Dropbox } from 'dropbox';
import type { DropboxDownloadResult, files } from 'dropbox';
import type { FetchLike } from '@/infrastructure/providers/transport';
import { sleep } from '@/infrastructure/providers/transport';
import {
  SyncProviderError,
  type RemoteBackupInfo,
  type RemoteFileMetadata,
  type SyncProviderUploadOptions,
} from '../types';

/**
 * The single synced file (ADR-015). Paths are relative to the app's root: for
 * an "App folder" scoped app the API root *is* the app folder, so the file
 * lives at `/sync.json.gz` (not `/Apps/<name>/…`, which is a Full-Dropbox path).
 */
export const DROPBOX_SYNC_PATH = '/sync.json.gz';

/** App root; recovery backups live alongside the sync file (ADR-017 step 4e). */
export const DROPBOX_BACKUP_DIR = '';

/** Backup filename prefix/suffix; the full name is `sync.backup-<ISO>.json.gz`. */
export const DROPBOX_BACKUP_PREFIX = 'sync.backup-';
export const DROPBOX_BACKUP_SUFFIX = '.json.gz';

/** MIME type the sync file is uploaded with (ADR-016). */
export const DROPBOX_CONTENT_TYPE = 'application/gzip';

/** Build a backup filename from an ISO-8601 timestamp (ADR-017 step 4e). */
export function dropboxBackupFileName(isoTimestamp: string): string {
  return `${DROPBOX_BACKUP_PREFIX}${isoTimestamp}${DROPBOX_BACKUP_SUFFIX}`;
}

/** The full Dropbox path of a backup file. */
export function dropboxBackupPath(name: string): string {
  return `${DROPBOX_BACKUP_DIR}/${name}`;
}

/** Default retry policy for transient Dropbox transport failures. */
export const DROPBOX_MAX_ATTEMPTS = 3;
export const dropboxRetryDelayMs = (attempt: number): number =>
  Math.min(500 * 2 ** (attempt - 1), 8000);

export interface DropboxClientOptions {
  /** Public app key (client id). */
  readonly clientId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly fetchImpl: FetchLike;
  readonly path?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: (attempt: number) => number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Wrap the injected fetch with a bounded retry for transient statuses. The SDK
 * sees a single successful/terminal response; it never retries on its own.
 */
function createRetryingFetch(
  fetchImpl: FetchLike,
  maxAttempts: number,
  retryDelayMs: (attempt: number) => number,
  sleepImpl: (ms: number) => Promise<void>,
): FetchLike {
  return async (input, init) => {
    let attempt = 1;
    for (;;) {
      try {
        const response = await fetchImpl(input, init);
        if (response.ok || attempt >= maxAttempts || !isRetryableStatus(response.status)) {
          return response;
        }
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }
      }
      await sleepImpl(retryDelayMs(attempt));
      attempt += 1;
    }
  };
}

function dropboxStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return null;
}

/** Whether the SDK error represents a missing path (Dropbox uses 409 too). */
function isNotFoundError(error: unknown): boolean {
  const status = dropboxStatus(error);
  if (status === 404) {
    return true;
  }
  if (status !== 409 || typeof error !== 'object' || error === null) {
    return false;
  }
  const body = (error as { error?: unknown }).error;
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const inner = (body as { error?: unknown }).error;
  if (typeof inner !== 'object' || inner === null) {
    return false;
  }
  if ((inner as { '.tag'?: unknown })['.tag'] !== 'path') {
    return false;
  }
  const path = (inner as { path?: unknown }).path;
  return (
    typeof path === 'object' &&
    path !== null &&
    (path as { '.tag'?: unknown })['.tag'] === 'not_found'
  );
}

/** Map any SDK/HTTP/network failure to a typed `SyncProviderError`. */
export function mapDropboxError(error: unknown, context?: string): SyncProviderError {
  if (error instanceof SyncProviderError) {
    return error;
  }
  const where = context !== undefined ? ` [${context}]` : '';
  const status = dropboxStatus(error);
  if (status !== null) {
    const detail = dropboxErrorDetail(error);
    const suffix = detail !== null ? `: ${detail}` : '';
    if (status === 401) {
      return new SyncProviderError(
        'auth',
        `Dropbox rejected the access token (401)${where}${suffix}.`,
      );
    }
    if (status === 403) {
      return new SyncProviderError(
        'forbidden',
        `Dropbox refused the request (403)${where}${suffix}.`,
      );
    }
    if (status === 409) {
      return new SyncProviderError(
        'conflict',
        `Dropbox reported a conflict (409)${where}${suffix}.`,
      );
    }
    if (status === 429) {
      return new SyncProviderError(
        'rate-limited',
        `Dropbox rate-limited the request (429)${where}${suffix}.`,
      );
    }
    if (status === 404) {
      return new SyncProviderError(
        'http',
        `Dropbox could not find the requested path (404)${where}${suffix}.`,
      );
    }
    return new SyncProviderError('http', `Dropbox returned HTTP ${status}${where}${suffix}.`);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new SyncProviderError('aborted', 'The Dropbox request was aborted.');
  }
  return new SyncProviderError(
    'network',
    error instanceof Error ? error.message : 'The Dropbox request failed.',
  );
}

/**
 * Best-effort detail from a Dropbox/SDK error body. File-API errors carry
 * `{ error_summary, error: {...} }`; OAuth-style errors carry `{ error: "code" }`.
 */
function dropboxErrorDetail(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const record = error as { error?: unknown; error_summary?: unknown };
  const body = record.error;
  if (typeof body === 'string' && body.length > 0) {
    return body;
  }
  if (typeof body === 'object' && body !== null) {
    const summary = (body as { error_summary?: unknown }).error_summary;
    if (typeof summary === 'string' && summary.length > 0) {
      return summary;
    }
    try {
      const json = JSON.stringify(body);
      if (json.length > 0 && json !== '{}') {
        return json.length > 300 ? `${json.slice(0, 300)}…` : json;
      }
    } catch {
      // Fall through to the top-level summary.
    }
  }
  if (typeof record.error_summary === 'string' && record.error_summary.length > 0) {
    return record.error_summary;
  }
  return null;
}

function toRemoteMetadata(metadata: files.FileMetadata): RemoteFileMetadata {
  const contentHash = metadata.content_hash;
  if (typeof metadata.rev !== 'string' || typeof contentHash !== 'string') {
    throw new SyncProviderError(
      'invalid-response',
      'Dropbox file metadata is missing rev/content_hash.',
    );
  }
  return {
    rev: metadata.rev,
    contentHash,
    size: metadata.size,
    serverModified: metadata.server_modified,
  };
}

function backupInfoFromMetadata(metadata: files.FileMetadataReference): RemoteBackupInfo {
  return {
    id: metadata.id,
    name: metadata.name,
    rev: metadata.rev,
    contentHash: metadata.content_hash ?? '',
    size: metadata.size,
    serverModified: metadata.server_modified,
  };
}

function isBackupName(name: string): boolean {
  return name.startsWith(DROPBOX_BACKUP_PREFIX) && name.endsWith(DROPBOX_BACKUP_SUFFIX);
}

async function extractDownloadBytes(
  result: DropboxDownloadResult<files.FileMetadata>,
): Promise<Uint8Array> {
  if (result.fileBinary) {
    return Uint8Array.from(result.fileBinary);
  }
  if (result.fileBlob) {
    return new Uint8Array(await result.fileBlob.arrayBuffer());
  }
  throw new SyncProviderError('invalid-response', 'Dropbox download returned no file content.');
}

/**
 * A stateless Dropbox file client. The provider constructs a fresh instance per
 * operation after ensuring the access token is current.
 */
export class DropboxClient {
  private readonly sdk: Dropbox;
  private readonly path: string;

  constructor(options: DropboxClientOptions) {
    this.path = options.path ?? DROPBOX_SYNC_PATH;
    const fetchImpl = createRetryingFetch(
      options.fetchImpl,
      options.maxAttempts ?? DROPBOX_MAX_ATTEMPTS,
      options.retryDelayMs ?? dropboxRetryDelayMs,
      options.sleepImpl ?? ((ms) => sleep(ms)),
    );
    this.sdk = new Dropbox({
      clientId: options.clientId,
      accessToken: options.accessToken,
      accessTokenExpiresAt: options.accessTokenExpiresAt,
      refreshToken: options.refreshToken,
      fetch: fetchImpl,
    });
  }

  /** Metadata for the sync file, or `null` when it does not exist yet. */
  async getMetadata(): Promise<RemoteFileMetadata | null> {
    try {
      const response = await this.sdk.filesGetMetadata({ path: this.path });
      const metadata = response.result;
      if (metadata['.tag'] !== 'file') {
        throw new SyncProviderError(
          'invalid-response',
          'The Dropbox sync path does not reference a file.',
        );
      }
      return toRemoteMetadata(metadata);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw mapDropboxError(error, `files/get_metadata ${this.path}`);
    }
  }

  /** Download the raw gzipped sync file bytes. */
  async download(): Promise<Uint8Array> {
    try {
      const response = await this.sdk.filesDownload({ path: this.path });
      return await extractDownloadBytes(response.result);
    } catch (error) {
      throw mapDropboxError(error, `files/download ${this.path}`);
    }
  }

  /** Upload bytes, updating `rev` (`mode.update`) or creating the file. */
  async upload(bytes: Uint8Array, options: SyncProviderUploadOptions): Promise<RemoteFileMetadata> {
    const mode: files.WriteMode =
      options.rev !== null ? { '.tag': 'update', update: options.rev } : { '.tag': 'add' };
    try {
      const response = await this.sdk.filesUpload({
        path: this.path,
        mode,
        autorename: options.autorename ?? false,
        mute: true,
        contents: bytes,
      });
      return toRemoteMetadata(response.result);
    } catch (error) {
      throw mapDropboxError(error, `files/upload ${this.path}`);
    }
  }

  /** List timestamped recovery backups in the App Folder. */
  async listBackups(): Promise<RemoteBackupInfo[]> {
    try {
      const backups: RemoteBackupInfo[] = [];
      let response = await this.sdk.filesListFolder({ path: DROPBOX_BACKUP_DIR });
      for (;;) {
        for (const entry of response.result.entries) {
          if (entry['.tag'] === 'file' && isBackupName(entry.name)) {
            backups.push(backupInfoFromMetadata(entry));
          }
        }
        if (!response.result.has_more) {
          break;
        }
        response = await this.sdk.filesListFolderContinue({ cursor: response.result.cursor });
      }
      return backups.sort((a, b) => a.serverModified.localeCompare(b.serverModified));
    } catch (error) {
      throw mapDropboxError(error, `files/list_folder ${DROPBOX_BACKUP_DIR}`);
    }
  }

  /** Download one timestamped recovery backup by its bare filename. */
  async downloadBackup(name: string): Promise<Uint8Array> {
    if (!isBackupName(name) || name.includes('/')) {
      throw new SyncProviderError('invalid-response', `Invalid Dropbox backup name: ${name}.`);
    }
    try {
      const response = await this.sdk.filesDownload({ path: dropboxBackupPath(name) });
      return await extractDownloadBytes(response.result);
    } catch (error) {
      throw mapDropboxError(error, `files/download ${dropboxBackupPath(name)}`);
    }
  }
}
