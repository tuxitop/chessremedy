import { describe, expect, it } from 'vitest';
import {
  PROFILE_CONFIGS,
  ANALYSIS_PROFILE_ORDER,
  profileConfig,
  resolveProfileConfig,
} from './engineProfiles';
import { resolveEngineCapabilities } from './capabilities';
import type { EngineCapabilities } from './capabilities';

const DESKTOP_SINGLE: EngineCapabilities = {
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  hardwareConcurrency: 8,
  isMobile: false,
  build: 'lite-single',
  threads: 1,
  hashCapMb: 256,
};

const DESKTOP_MULTI: EngineCapabilities = {
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  hardwareConcurrency: 8,
  isMobile: false,
  build: 'lite',
  threads: 2,
  hashCapMb: 256,
};

const MOBILE_SINGLE: EngineCapabilities = {
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  hardwareConcurrency: 4,
  isMobile: true,
  build: 'lite-single',
  threads: 1,
  hashCapMb: 64,
};

describe('engine profiles (ADR-012 table)', () => {
  it('defines the canonical V1 profile set', () => {
    expect(ANALYSIS_PROFILE_ORDER).toEqual(['fast', 'normal', 'tactical', 'deep']);
    for (const profile of ANALYSIS_PROFILE_ORDER) {
      expect(profileConfig(profile).profile).toBe(profile);
    }
  });

  it('maps the ADR-012 depth/hash/MultiPV table', () => {
    expect(profileConfig('fast')).toMatchObject({ depth: 10, hashMb: 16, multipv: 1 });
    expect(profileConfig('normal')).toMatchObject({ depth: 20, hashMb: 64, multipv: 1 });
    expect(profileConfig('tactical')).toMatchObject({ depth: 22, hashMb: 128, multipv: 5 });
    expect(profileConfig('deep')).toMatchObject({ depth: 30, hashMb: 256, multipv: 3 });
  });

  it('leaves WDL off for fast and on for the other profiles (ADR-019)', () => {
    expect(profileConfig('fast').showWdl).toBe(false);
    expect(profileConfig('normal').showWdl).toBe(true);
    expect(profileConfig('tactical').showWdl).toBe(true);
    expect(profileConfig('deep').showWdl).toBe(true);
  });

  it('produces deterministic UCI option sets per profile', () => {
    for (const profile of ANALYSIS_PROFILE_ORDER) {
      const a = resolveProfileConfig(profile, DESKTOP_MULTI);
      const b = resolveProfileConfig(profile, DESKTOP_MULTI);
      expect(a).toEqual(b);
    }
  });

  it('clamps hash to the browser capability cap', () => {
    const mobileTactical = resolveProfileConfig('tactical', MOBILE_SINGLE);
    // tactical asks for 128 MB; mobile caps at 64 MB.
    expect(mobileTactical.options.find((o) => o.name === 'Hash')?.value).toBe('64');
    const desktopDeep = resolveProfileConfig('deep', DESKTOP_SINGLE);
    expect(desktopDeep.options.find((o) => o.name === 'Hash')?.value).toBe('256');
  });

  it('only sets Threads for the multi-threaded build', () => {
    const single = resolveProfileConfig('normal', DESKTOP_SINGLE);
    expect(single.options.some((o) => o.name === 'Threads')).toBe(false);
    const multi = resolveProfileConfig('normal', DESKTOP_MULTI);
    expect(multi.options.find((o) => o.name === 'Threads')?.value).toBe('2');
  });

  it('always sets MultiPV and UCI_ShowWDL explicitly', () => {
    for (const profile of ANALYSIS_PROFILE_ORDER) {
      const resolved = resolveProfileConfig(profile, DESKTOP_SINGLE);
      expect(resolved.options.find((o) => o.name === 'MultiPV')?.value).toBe(
        String(PROFILE_CONFIGS[profile].multipv),
      );
      expect(resolved.options.find((o) => o.name === 'UCI_ShowWDL')?.value).toBe(
        PROFILE_CONFIGS[profile].showWdl ? 'true' : 'false',
      );
    }
  });
});

describe('capabilities', () => {
  it('detects mobile by touch or coarse pointer', () => {
    const base = {
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      hardwareConcurrency: 4,
    };
    expect(
      resolveEngineCapabilities({ ...base, touchPoints: 5, coarsePointer: false }).isMobile,
    ).toBe(true);
    expect(
      resolveEngineCapabilities({ ...base, touchPoints: 0, coarsePointer: true }).isMobile,
    ).toBe(true);
    expect(
      resolveEngineCapabilities({ ...base, touchPoints: 0, coarsePointer: false }).isMobile,
    ).toBe(false);
  });

  it('defaults to the single-threaded lite build without cross-origin isolation', () => {
    const caps = resolveEngineCapabilities({
      sharedArrayBuffer: true,
      crossOriginIsolated: false,
      hardwareConcurrency: 8,
      touchPoints: 0,
      coarsePointer: false,
    });
    expect(caps.build).toBe('lite-single');
    expect(caps.threads).toBe(1);
  });

  it('upgrades to the multi-threaded lite build when isolated with cores', () => {
    const caps = resolveEngineCapabilities({
      sharedArrayBuffer: true,
      crossOriginIsolated: true,
      hardwareConcurrency: 8,
      touchPoints: 0,
      coarsePointer: false,
    });
    expect(caps.build).toBe('lite');
    expect(caps.threads).toBe(2);
  });

  it('does not upgrade with a single core even when isolated', () => {
    const caps = resolveEngineCapabilities({
      sharedArrayBuffer: true,
      crossOriginIsolated: true,
      hardwareConcurrency: 1,
      touchPoints: 0,
      coarsePointer: false,
    });
    expect(caps.build).toBe('lite-single');
  });

  it('caps hash at 64 MB mobile / 256 MB desktop', () => {
    const mobile = resolveEngineCapabilities({
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      hardwareConcurrency: 4,
      touchPoints: 5,
      coarsePointer: false,
    });
    const desktop = resolveEngineCapabilities({
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      hardwareConcurrency: 8,
      touchPoints: 0,
      coarsePointer: false,
    });
    expect(mobile.hashCapMb).toBe(64);
    expect(desktop.hashCapMb).toBe(256);
  });
});
