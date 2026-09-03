/**
 * Engine asset/build metadata resolution (Feature 005).
 *
 * The engine assets and their identity are generated at install time by
 * `scripts/copy-stockfish-assets.mjs` into `public/stockfish/meta.json`
 * (ADR-012 consequence). The engine service fetches that manifest once and
 * derives worker URLs and engine identity from it, so no Stockfish version
 * string is hard-coded into runtime code (ARCHITECTURE.md §9, ADR-020).
 *
 * Fetching is browser-only; all other functions here are pure and
 * Node-testable.
 */

import type { AnalysisProfile, EngineMetadata } from '@/domain/chess';
import type { EngineBuildId } from './types';

export const ENGINE_NAME = 'stockfish';

export interface EngineAssetBuild {
  readonly id: EngineBuildId;
  readonly js: string;
  readonly wasm: string;
}

export interface EngineAssets {
  readonly engineName: typeof ENGINE_NAME;
  /** Engine release, e.g. `18` (from the npm package `buildVersion`). */
  readonly engineRelease: string;
  /** npm package version, e.g. `18.0.8`. */
  readonly npmVersion: string;
  readonly builds: readonly EngineAssetBuild[];
}

export class EngineAssetsError extends Error {}

export async function fetchEngineAssets(baseUrl: string): Promise<EngineAssets> {
  const url = `${baseUrl}stockfish/meta.json`;
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin' });
  } catch (err) {
    throw new EngineAssetsError(`Could not fetch engine manifest (${url}): ${String(err)}`);
  }
  if (!response.ok) {
    throw new EngineAssetsError(`Engine manifest request failed: HTTP ${response.status} (${url})`);
  }
  const data = (await response.json()) as Partial<EngineAssets>;
  if (
    data.engineName !== ENGINE_NAME ||
    typeof data.engineRelease !== 'string' ||
    typeof data.npmVersion !== 'string' ||
    !Array.isArray(data.builds)
  ) {
    throw new EngineAssetsError(`Engine manifest is malformed (${url})`);
  }
  return data as EngineAssets;
}

export function findEngineBuild(assets: EngineAssets, buildId: EngineBuildId): EngineAssetBuild {
  const build = assets.builds.find((b) => b.id === buildId);
  if (!build) {
    throw new EngineAssetsError(
      `Engine build "${buildId}" not shipped (available: ${assets.builds.map((b) => b.id).join(', ')})`,
    );
  }
  return build;
}

export function engineBuildToken(release: string, buildId: EngineBuildId): string {
  return `stockfish-${release}-${buildId}`;
}

/** Absolute/relative URL of a build's worker script under a base path. */
export function workerScriptUrl(
  assets: EngineAssets,
  buildId: EngineBuildId,
  baseUrl: string,
): string {
  const build = findEngineBuild(assets, buildId);
  return `${baseUrl}stockfish/${build.js}`;
}

export function engineMetadataFor(
  assets: EngineAssets,
  buildId: EngineBuildId,
  profile: AnalysisProfile,
): EngineMetadata {
  return {
    engineName: assets.engineName,
    engineVersion: assets.npmVersion,
    engineBuild: engineBuildToken(assets.engineRelease, buildId),
    profile,
  };
}
