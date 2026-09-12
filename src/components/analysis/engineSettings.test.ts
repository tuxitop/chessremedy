import { describe, expect, it } from 'vitest';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import {
  analysisOptionsFromSettings,
  clampDepth,
  clampLines,
  clampSearchSeconds,
  defaultLiveSettings,
  liveProfilePreset,
  settingsWithProfile,
  type LiveEngineSettings,
} from './engineSettings';

const CAPS_DESKTOP: EngineCapabilities = {
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  hardwareConcurrency: 4,
  isMobile: false,
  build: 'lite-single',
  threads: 1,
  hashCapMb: 256,
};

const CAPS_LITE: EngineCapabilities = {
  ...CAPS_DESKTOP,
  build: 'lite',
  threads: 2,
};

describe('live engine settings', () => {
  it('clamps line counts, search time and depth', () => {
    expect(clampLines(9)).toBe(5);
    expect(clampLines(-2)).toBe(1);
    expect(clampLines(3)).toBe(3);
    expect(clampSearchSeconds(0.4)).toBe(1);
    expect(clampSearchSeconds(2)).toBe(2);
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(400)).toBe(128);
    expect(clampDepth(20)).toBe(20);
  });

  it('defaults to the normal profile with 3 lines and capability-capped memory', () => {
    const s = defaultLiveSettings(CAPS_DESKTOP);
    expect(s).toMatchObject({
      engine: 'stockfish',
      profile: 'normal',
      lines: 3,
      depth: 17,
      arrows: 'first',
    });
    expect(s.memoryMb).toBe(64);
    expect(s.threads).toBe(1);
    expect(s.searchSeconds).toBe(5);
  });

  it('derives live presets per profile', () => {
    const fast = liveProfilePreset('fast', CAPS_DESKTOP);
    expect(fast).toMatchObject({ depth: 10, searchSeconds: 2, lines: 1, threads: 1, memoryMb: 16 });
    const deep = liveProfilePreset('deep', CAPS_DESKTOP);
    expect(deep).toMatchObject({ depth: 30, searchSeconds: 15, lines: 3, memoryMb: 256 });
    const tactical = liveProfilePreset('tactical', CAPS_DESKTOP);
    expect(tactical).toMatchObject({ depth: 22, searchSeconds: 8, lines: 5, memoryMb: 128 });
  });

  it('caps memory and threads to the capability on the multi-threaded build', () => {
    const preset = liveProfilePreset('deep', { ...CAPS_LITE, hashCapMb: 128 });
    expect(preset).toMatchObject({ memoryMb: 128, threads: 2 });
  });

  it('applies a profile preset onto existing settings', () => {
    const base: LiveEngineSettings = {
      engine: 'stockfish',
      profile: 'fast',
      depth: 10,
      searchSeconds: 2,
      lines: 1,
      threads: 1,
      memoryMb: 16,
      arrows: 'all',
    };
    const next = settingsWithProfile(base, 'deep', CAPS_DESKTOP);
    expect(next).toMatchObject({
      profile: 'deep',
      depth: 30,
      searchSeconds: 15,
      lines: 3,
      memoryMb: 256,
      arrows: 'all',
    });
  });

  it('derives analysis options carrying all live overrides', () => {
    const s: LiveEngineSettings = {
      engine: 'stockfish',
      profile: 'normal',
      depth: 18,
      searchSeconds: 5,
      lines: 3,
      threads: 1,
      memoryMb: 64,
      arrows: 'first',
    };
    expect(analysisOptionsFromSettings(s)).toEqual({
      profile: 'normal',
      maxDepth: 18,
      movetimeMs: 5000,
      multipv: 3,
      hashMb: 64,
      threads: 1,
    });
  });
});
