/**
 * Game-analysis engine configuration (Feature 008 polish, Q2 = Option A).
 *
 * Pure, deterministic configuration helpers for the Settings "Game analysis"
 * group: the engine profile (fast/normal/deep) plus an optional depth override
 * and an optional per-position search time. There is deliberately no "side
 * scope" control (Q1 dropped — a game analysis always classifies both sides,
 * because engine positions are identical either way).
 *
 * The resolved overrides are part of a run's identity (`AnalysisJob.config`),
 * of the `outdated` derivation and of the ADR-018 session-cache key. The
 * profile's own depth/hash/MultiPV stay authoritative unless overridden, so a
 * default run keeps the historical analysis identity.
 */

import type { AnalysisProfile } from '@/domain/chess';
import type { ExpectedAnalysisConfig, GameAnalysisConfig } from '@/domain/analysis';
import { profileConfig } from '@/infrastructure/engine/engineProfiles';
import { AVAILABLE_ENGINES, DEFAULT_ENGINE_ID, type EngineId } from './engineSettings';

/** Profiles offered for full-game analysis (ADR-012 presets). */
export type GameAnalysisProfile = 'fast' | 'normal' | 'deep';
export const GAME_ANALYSIS_PROFILE_ORDER: readonly GameAnalysisProfile[] = [
  'fast',
  'normal',
  'deep',
];
export const GAME_ANALYSIS_PROFILE_DEFAULT: GameAnalysisProfile = 'normal';

/** Depth-override bounds (1..128, matching the live board). */
export const GAME_ANALYSIS_DEPTH_MIN = 1;
export const GAME_ANALYSIS_DEPTH_MAX = 128;
/** Per-position search-time bounds in seconds (no upper clamp; ≥ 1). */
export const GAME_ANALYSIS_SEARCH_MIN = 1;

/** Engine thread-count override bounds (≥ 1; upper bound is the capability cap). */
export const GAME_ANALYSIS_THREADS_MIN = 1;

export interface GameAnalysisSettings {
  /** Engine seam (Stockfish only today). */
  readonly engine: EngineId;
  readonly profile: GameAnalysisProfile;
  /**
   * Optional depth override. `null` = use the profile's own depth (ADR-012).
   */
  readonly depthOverride: number | null;
  /**
   * Optional per-position search time in seconds. `null` = no time bound (the
   * engine searches to the depth limit).
   */
  readonly searchSeconds: number | null;
  /**
   * Optional engine thread-count override. `null` = the engine's
   * capability-derived default (ADR-012). Only meaningful on the
   * multi-threaded build, so the Settings control is disabled when the
   * capability cap is 1.
   */
  readonly threadsOverride: number | null;
}

export function defaultGameAnalysisSettings(): GameAnalysisSettings {
  return {
    engine: DEFAULT_ENGINE_ID,
    profile: GAME_ANALYSIS_PROFILE_DEFAULT,
    depthOverride: null,
    searchSeconds: null,
    threadsOverride: null,
  };
}

/** Clamp a depth override into [GAME_ANALYSIS_DEPTH_MIN, MAX]. */
export function clampGameAnalysisDepth(depth: number): number {
  return Math.min(GAME_ANALYSIS_DEPTH_MAX, Math.max(GAME_ANALYSIS_DEPTH_MIN, Math.round(depth)));
}

/** Clamp a per-position search time (seconds) to an integer ≥ 1. */
export function clampGameAnalysisSearchSeconds(seconds: number): number {
  return Math.max(GAME_ANALYSIS_SEARCH_MIN, Math.round(seconds));
}

/**
 * Clamp a thread-count override into `[MIN, maxThreads]`. `maxThreads` is the
 * engine's capability cap (1 on the single-threaded build); a result of 1 is
 * not an override (the default is already 1), which is why resolution drops it.
 */
export function clampGameAnalysisThreads(threads: number, maxThreads: number): number {
  return Math.min(Math.max(GAME_ANALYSIS_THREADS_MIN, Math.round(threads)), maxThreads);
}

export { AVAILABLE_ENGINES, DEFAULT_ENGINE_ID };
export type { EngineId };

/**
 * The per-position engine overrides actually applied for a Game-analysis run
 * (identity `AnalysisJob.config`): `maxDepth` and `movetimeMs` are present only
 * when the user explicitly overrode the profile — a default run applies no
 * override and keeps the historical identity/cache key.
 */
export interface ResolvedGameAnalysisConfig {
  readonly profile: AnalysisProfile;
  readonly maxDepth?: number;
  readonly movetimeMs?: number;
}

export function resolvedGameAnalysisConfig(
  settings: GameAnalysisSettings,
): ResolvedGameAnalysisConfig {
  return {
    profile: settings.profile,
    ...(settings.depthOverride !== null
      ? { maxDepth: clampGameAnalysisDepth(settings.depthOverride) }
      : {}),
    ...(settings.searchSeconds !== null
      ? { movetimeMs: clampGameAnalysisSearchSeconds(settings.searchSeconds) * 1000 }
      : {}),
  };
}

/** The profile's own depth (used by the Settings copy / placeholder text). */
export function gameAnalysisProfileDepth(profile: GameAnalysisProfile): number {
  return profileConfig(profile).depth;
}

/**
 * The per-position overrides a run carries under `settings`, or `undefined`
 * when the user overrode nothing. A threads override of 1 is the single-thread
 * default and is dropped (it is not an override); the engine clamps higher
 * stored values to the current capability cap.
 */
export function gameAnalysisOverrides(
  settings: GameAnalysisSettings,
): GameAnalysisConfig | undefined {
  const overrides: Array<[keyof GameAnalysisConfig, number]> = [];
  if (settings.depthOverride !== null) {
    overrides.push(['maxDepth', clampGameAnalysisDepth(settings.depthOverride)]);
  }
  if (settings.searchSeconds !== null) {
    overrides.push(['movetimeMs', clampGameAnalysisSearchSeconds(settings.searchSeconds) * 1000]);
  }
  if (settings.threadsOverride !== null && settings.threadsOverride > 1) {
    overrides.push(['threads', settings.threadsOverride]);
  }
  return overrides.length > 0 ? Object.fromEntries(overrides) : undefined;
}

/**
 * What a *fresh* run under `settings` feeds to `analyzeGames`: the engine
 * profile plus the resolved overrides (identity `AnalysisJob.config`). A
 * default run carries no override so it keeps the historical identity and
 * ADR-018 cache key.
 */
export function gameAnalysisRunOf(settings: GameAnalysisSettings): {
  readonly profile: GameAnalysisProfile;
  readonly config?: GameAnalysisConfig;
} {
  const config = gameAnalysisOverrides(settings);
  return config !== undefined
    ? { profile: settings.profile, config }
    : { profile: settings.profile };
}

/**
 * The expected run configuration under `settings` for the `outdated`
 * derivation (Feature 008 §16): a completed run under a different profile or
 * different overrides reads `outdated`, offering an opt-in re-analysis.
 */
export function expectedGameAnalysisConfig(settings: GameAnalysisSettings): ExpectedAnalysisConfig {
  const config = gameAnalysisOverrides(settings);
  return config !== undefined
    ? { profile: settings.profile, config }
    : { profile: settings.profile };
}
