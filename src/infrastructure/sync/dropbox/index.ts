/**
 * Feature 016 — Dropbox adapter barrel.
 *
 * Re-exports the PKCE/auth helpers, the thin SDK client and the
 * `SyncProvider` implementation. The official `dropbox` SDK is imported only
 * by `dropboxClient`; nothing here leaks SDK types.
 */

export {
  DROPBOX_AUTHORIZE_URL,
  DROPBOX_PKCE_STORAGE_KEY,
  DROPBOX_TOKEN_EXPIRY_BUFFER_MS,
  DROPBOX_TOKEN_URL,
  DropboxAuthStore,
  base64UrlEncode,
  buildAuthorizeUrl,
  codeChallengeS256,
  createCodeVerifier,
  createPkcePair,
  exchangeCode,
  refreshToken,
  type AuthorizeUrlParams,
  type DropboxAuthStoreOptions,
  type DropboxSessionStore,
  type DropboxTokens,
  type ExchangeCodeParams,
  type PkceDigestFn,
  type PkcePair,
  type RandomBytesFn,
  type RefreshTokenParams,
} from './dropboxAuth';

export {
  DROPBOX_BACKUP_DIR,
  DROPBOX_BACKUP_PREFIX,
  DROPBOX_BACKUP_SUFFIX,
  DROPBOX_CONTENT_TYPE,
  DROPBOX_MAX_ATTEMPTS,
  DROPBOX_SYNC_PATH,
  DropboxClient,
  dropboxBackupFileName,
  dropboxBackupPath,
  dropboxRetryDelayMs,
  mapDropboxError,
  type DropboxClientOptions,
} from './dropboxClient';

export { DropboxProvider, readDropboxAppKey, type DropboxProviderOptions } from './dropboxProvider';
