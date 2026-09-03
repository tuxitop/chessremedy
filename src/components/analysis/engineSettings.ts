/**
 * Live-analysis engine configuration helpers (Feature 006).
 *
 * Pure, deterministic configuration resolution used by the engine settings
 * popover, the Settings page defaults and tests. The ADR-012 profile table
 * stays authoritative for depth / hash / MultiPV on the engine profiles; the
 * live board adds per-profile *search time* presets (reviewer-open numbers)
 * used only to auto-fill the session controls.
 */

import { ANALYSIS_PROFILES, type AnalysisProfile } from '@/domain/chess';
import { profileConfig } from '@/infrastructure/engine/engineProfiles';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';

/** Engines available to live analysis (seam for a future second engine). */
export type EngineId = 'stockfish';

export interface EngineDescriptor {
  readonly id: EngineId;
  readonly label: string;
}

export const AVAILABLE_ENGINES: readonly EngineDescriptor[] = [
  { id: 'stockfish', label: 'Stockfish' },
];

export const DEFAULT_ENGINE_ID: EngineId = 'stockfish';

/** User-facing, session-level engine configuration for live analysis. */
export interface LiveEngineSettings {
  readonly engine: EngineId;
  readonly profile: AnalysisProfile;
  /** Search time in seconds (combined with the profile depth, whichever first). */
  readonly searchSeconds: number;
  /** Number of principal-variation lines (MultiPV), 1..5. */
  readonly lines: number;
  /** Threads to request (clamped to the build's capability). */
  readonly threads: number;
  /** Hash size in MB (clamped to the capability cap). */
  readonly memoryMb: number;
}

export const LIVE_LINES_MIN = 1;
export const LIVE_LINES_MAX = 5;
export const LIVE_LINES_DEFAULT = 3;
export const LIVE_SEARCH_SECONDS_MIN = 1;

/**
 * Default search time in seconds per profile for the live board. The ADR-012
 * table fixes depth/hash/MultiPV for stored analyses; these live defaults are
 * reviewer-open and affect only session analysis.
 */
const LIVE_SEARCH_SECONDS: Record<AnalysisProfile, number> = {
  fast: 2,
  normal: 5,
  tactical: 8,
  deep: 15,
};

/** Clamp a search time (seconds) to a sane integer ≥ 1. */
export function clampSearchSeconds(seconds: number): number {
  return Math.max(LIVE_SEARCH_SECONDS_MIN, Math.round(seconds));
}

/** Clamp line count into 1..5. */
export function clampLines(lines: number): number {
  return Math.min(LIVE_LINES_MAX, Math.max(LIVE_LINES_MIN, Math.round(lines)));
}

/** Effective max threads a settings object may request. */
export function threadCap(capabilities: EngineCapabilities): number {
  return Math.max(1, capabilities.threads);
}

export interface LiveProfilePreset {
  readonly searchSeconds: number;
  /** MultiPV preset for the profile on the live board. */
  readonly lines: number;
  readonly threads: number;
  readonly memoryMb: number;
}

/**
 * Auto-configuration applied when the user selects a profile in the engine
 * settings. `lines` follows the profile's tactical intent (fast 1 / normal 3 /
 * tactical 5 / deep 3 — the Feature 006 default for the default profile),
 * threads come from the build capability and memory from the ADR-012 hash
 * clamped to the capability cap.
 */
export function liveProfilePreset(
  profile: AnalysisProfile,
  capabilities: EngineCapabilities,
): LiveProfilePreset {
  const config = profileConfig(profile);
  const linesFor: Record<AnalysisProfile, number> = {
    fast: 1,
    normal: LIVE_LINES_DEFAULT,
    tactical: 5,
    deep: 3,
  };
  return {
    searchSeconds: LIVE_SEARCH_SECONDS[profile],
    lines: linesFor[profile],
    threads: threadCap(capabilities),
    memoryMb: Math.min(config.hashMb, capabilities.hashCapMb),
  };
}

/** Apply a profile preset to an existing settings object. */
export function settingsWithProfile(
  settings: LiveEngineSettings,
  profile: AnalysisProfile,
  capabilities: EngineCapabilities,
): LiveEngineSettings {
  const preset = liveProfilePreset(profile, capabilities);
  return {
    ...settings,
    profile,
    searchSeconds: preset.searchSeconds,
    lines: preset.lines,
    threads: preset.threads,
    memoryMb: preset.memoryMb,
  };
}

/** Engine analysis options derived from live settings (Feature 006). */
export function analysisOptionsFromSettings(settings: LiveEngineSettings): {
  readonly profile: AnalysisProfile;
  readonly maxDepth: number;
  readonly movetimeMs: number;
  readonly multipv: number;
  readonly hashMb: number;
  readonly threads: number;
} {
  const depth = profileConfig(settings.profile).depth;
  return {
    profile: settings.profile,
    maxDepth: depth,
    movetimeMs: settings.searchSeconds * 1000,
    multipv: settings.lines,
    hashMb: settings.memoryMb,
    threads: settings.threads,
  };
}

/** Default live settings for the current capabilities (Settings defaults). */
export function defaultLiveSettings(capabilities: EngineCapabilities): LiveEngineSettings {
  const preset = liveProfilePreset('normal', capabilities);
  return {
    engine: DEFAULT_ENGINE_ID,
    profile: 'normal',
    searchSeconds: preset.searchSeconds,
    lines: preset.lines,
    threads: preset.threads,
    memoryMb: preset.memoryMb,
  };
}

export { ANALYSIS_PROFILES };
export type { AnalysisProfile };
