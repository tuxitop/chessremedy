/**
 * Feature 016 — sync configuration probe.
 *
 * Reads the public Dropbox app key from the build environment. This module
 * deliberately imports **no** Dropbox SDK code, so eager surfaces (the header
 * status indicator, the bootstrap composition root) can decide whether sync is
 * configured without pulling the SDK into the initial bundle. The SDK itself is
 * loaded lazily behind `import('@/infrastructure/sync')`.
 */

/** The configured Dropbox app key, or `undefined` when sync is not configured. */
export function readDropboxAppKeyFromEnv(): string | undefined {
  const key = import.meta.env.VITE_DROPBOX_APP_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined;
}

/** Whether a Dropbox app key is configured for this build. */
export function isSyncConfigured(): boolean {
  return readDropboxAppKeyFromEnv() !== undefined;
}
