/**
 * Browser engine-service assembly (Feature 005).
 *
 * Wires the browser capability detection, the fetched engine manifest and a
 * real Worker transport into an `EngineService`. Only ever used in the
 * browser (playground UI / Playwright); unit tests construct services with a
 * fake transport instead.
 *
 * ADR-034: the browser runs two engine services — the shared **analysis**
 * engine (Live Analysis + full-game analysis) and the dedicated **verification**
 * engine (Feature-010 Stage-2 tactical detection). They share one manifest
 * fetch / capability read but never a Worker, transport or queue. The
 * verification engine is a lazy, idle-disposing wrapper (ADR-034 lifecycle).
 */

import { fetchEngineAssets, workerScriptUrl, type EngineAssets } from './engineBuild';
import {
  readBrowserCapabilities,
  verificationCapabilities,
  type EngineCapabilities,
} from './capabilities';
import { createEngineService } from './engineService';
import { createCachedEngineService } from './cache';
import { createStockfishWorkerTransport } from './workerTransport';
import { createLazyEngineService } from './lazyEngineService';
import type { EngineService } from './types';

export function engineBaseUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

interface BrowserEngineEnvironment {
  readonly capabilities: EngineCapabilities;
  readonly assets: EngineAssets;
  readonly baseUrl: string;
  /** Worker script URL for the selected multi/single-threaded build. */
  readonly scriptUrl: string;
}

let browserEngineEnvironmentPromise: Promise<BrowserEngineEnvironment> | null = null;

/**
 * Resolve and memoise the browser engine environment once: capability read,
 * manifest fetch and worker-script URL. Both the analysis and verification
 * engines share this so the manifest is fetched at most once per session
 * (ADR-034).
 */
function getBrowserEngineEnvironment(): Promise<BrowserEngineEnvironment> {
  browserEngineEnvironmentPromise ??= (async () => {
    const capabilities = readBrowserCapabilities();
    const baseUrl = engineBaseUrl();
    const assets = await fetchEngineAssets(baseUrl);
    const scriptUrl = workerScriptUrl(assets, capabilities.build, baseUrl);
    return { capabilities, assets, baseUrl, scriptUrl };
  })();
  return browserEngineEnvironmentPromise;
}

export async function createBrowserEngineService(): Promise<EngineService> {
  const env = await getBrowserEngineEnvironment();
  return createEngineService({
    transportFactory: () => createStockfishWorkerTransport({ scriptUrl: env.scriptUrl }),
    capabilities: env.capabilities,
    assets: env.assets,
  });
}

let browserEngineServicePromise: Promise<EngineService> | null = null;

/** Lazily-created shared engine service for the browser (memoised). */
export function getBrowserEngineService(): Promise<EngineService> {
  browserEngineServicePromise ??= createBrowserEngineService();
  return browserEngineServicePromise;
}

let cachedEngineServicePromise: Promise<EngineService> | null = null;

/**
 * Lazily-created session-cached engine service (Feature 006): the shared
 * browser service wrapped with the position-keyed session cache so repeated
 * positions on the live board are served without re-running the worker.
 */
export function getCachedBrowserEngineService(): Promise<EngineService> {
  cachedEngineServicePromise ??= getBrowserEngineService().then((service) =>
    createCachedEngineService(service),
  );
  return cachedEngineServicePromise;
}

/**
 * Dedicated verification engine (ADR-034): the same build/hash selection as
 * the shared analysis engine but exactly 1 search thread, wrapped in a lazy,
 * idle-disposing service so no second WASM instance is created until a
 * Stage-2 detection job actually runs. It is its own Worker and FIFO and
 * shares only the ADR-018 position cache with the analysis engine.
 */
export async function createBrowserVerificationEngineService(): Promise<EngineService> {
  const env = await getBrowserEngineEnvironment();
  return createLazyEngineService({
    create: () =>
      createEngineService({
        transportFactory: () => createStockfishWorkerTransport({ scriptUrl: env.scriptUrl }),
        capabilities: verificationCapabilities(env.capabilities),
        assets: env.assets,
      }),
  });
}

let browserVerificationEngineServicePromise: Promise<EngineService> | null = null;

/** Lazily-created shared verification engine service for the browser (memoised). */
export function getBrowserVerificationEngineService(): Promise<EngineService> {
  browserVerificationEngineServicePromise ??= createBrowserVerificationEngineService();
  return browserVerificationEngineServicePromise;
}
