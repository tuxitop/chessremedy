/**
 * Browser engine-service assembly (Feature 005).
 *
 * Wires the browser capability detection, the fetched engine manifest and a
 * real Worker transport into an `EngineService`. Only ever used in the
 * browser (playground UI / Playwright); unit tests construct services with a
 * fake transport instead.
 */

import { fetchEngineAssets, workerScriptUrl } from './engineBuild';
import { readBrowserCapabilities } from './capabilities';
import { createEngineService } from './engineService';
import { createStockfishWorkerTransport } from './workerTransport';
import type { EngineService } from './types';

export function engineBaseUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export async function createBrowserEngineService(): Promise<EngineService> {
  const capabilities = readBrowserCapabilities();
  const baseUrl = engineBaseUrl();
  const assets = await fetchEngineAssets(baseUrl);
  const scriptUrl = workerScriptUrl(assets, capabilities.build, baseUrl);
  return createEngineService({
    transportFactory: () => createStockfishWorkerTransport({ scriptUrl }),
    capabilities,
    assets,
  });
}

let browserEngineServicePromise: Promise<EngineService> | null = null;

/** Lazily-created shared engine service for the browser (memoised). */
export function getBrowserEngineService(): Promise<EngineService> {
  browserEngineServicePromise ??= createBrowserEngineService();
  return browserEngineServicePromise;
}
