/**
 * Feature 018 — Home infrastructure barrel.
 *
 * Exposes the narrow `HomeDataSource` seam and its production browser
 * implementation. Importing this module statically pulls in the Dexie
 * repositories only; the statistics service is reached through a dynamic
 * import inside the adapter.
 */

export { createBrowserHomeDataSource } from './home-data-source';
export type { HomeDataSource, HomeMasteryData } from './home-data-source';
