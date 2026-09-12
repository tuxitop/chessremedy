/**
 * Analysis profile configuration data (Feature 005, ADR-012).
 *
 * Profiles are configuration data — there is no per-profile engine-control
 * logic here. Each profile maps to a deterministic UCI option set plus a
 * default depth limit. The ADR-012 table is the source of truth:
 *
 *   | Profile   | Depth | Hash   | MultiPV |
 *   |-----------|-------|--------|---------|
 *   | fast      | 10    | 16 MB  | 1       |
 *   | normal    | 17    | 64 MB  | 1       |
 *   | tactical  | 22    | 128 MB | 5       |
 *   | deep      | 30    | 256 MB | 3       |
 *
 * `normal` is the ADR default. `fast` keeps `UCI_ShowWDL` off (ADR-019: WDL
 * is `null` for the fast profile); the other profiles enable it.
 */

import type { AnalysisProfile } from '@/domain/chess';
import type { EngineCapabilities } from './capabilities';

export interface ProfileConfig {
  readonly profile: AnalysisProfile;
  readonly label: string;
  readonly depth: number;
  readonly hashMb: number;
  readonly multipv: number;
  readonly showWdl: boolean;
}

export const PROFILE_CONFIGS: Record<AnalysisProfile, ProfileConfig> = {
  fast: { profile: 'fast', label: 'Fast', depth: 10, hashMb: 16, multipv: 1, showWdl: false },
  normal: { profile: 'normal', label: 'Normal', depth: 17, hashMb: 64, multipv: 1, showWdl: true },
  tactical: {
    profile: 'tactical',
    label: 'Tactical',
    depth: 22,
    hashMb: 128,
    multipv: 5,
    showWdl: true,
  },
  deep: { profile: 'deep', label: 'Deep', depth: 30, hashMb: 256, multipv: 3, showWdl: true },
};

export const ANALYSIS_PROFILE_ORDER: readonly AnalysisProfile[] = [
  'fast',
  'normal',
  'tactical',
  'deep',
];

export interface UciOptionSetting {
  readonly name: string;
  readonly value: string;
}

/**
 * Resolved engine configuration for one profile under the given browser
 * capabilities: hash is clamped to the capability cap, threads are only set
 * for the multi-threaded build, and every option is explicit so the worker
 * is returned to a known state between jobs of different profiles.
 */
export interface ResolvedProfileConfig {
  readonly profile: AnalysisProfile;
  readonly config: ProfileConfig;
  readonly depth: number;
  readonly options: readonly UciOptionSetting[];
}

export function profileConfig(profile: AnalysisProfile): ProfileConfig {
  return PROFILE_CONFIGS[profile];
}

export function resolveProfileConfig(
  profile: AnalysisProfile,
  capabilities: EngineCapabilities,
): ResolvedProfileConfig {
  const config = PROFILE_CONFIGS[profile];
  const hashMb = Math.min(config.hashMb, capabilities.hashCapMb);

  const options: UciOptionSetting[] = [];
  if (capabilities.build === 'lite' && capabilities.threads > 1) {
    options.push({ name: 'Threads', value: String(capabilities.threads) });
  }
  options.push({ name: 'Hash', value: String(hashMb) });
  options.push({ name: 'MultiPV', value: String(config.multipv) });
  options.push({ name: 'UCI_ShowWDL', value: config.showWdl ? 'true' : 'false' });

  return { profile, config, depth: config.depth, options };
}
