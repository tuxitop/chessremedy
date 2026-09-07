import { describe, expect, it } from 'vitest';
import {
  clampGameAnalysisDepth,
  clampGameAnalysisSearchSeconds,
  clampGameAnalysisThreads,
  defaultGameAnalysisSettings,
  expectedGameAnalysisConfig,
  gameAnalysisOverrides,
  gameAnalysisProfileDepth,
  gameAnalysisRunOf,
  resolvedGameAnalysisConfig,
  type GameAnalysisSettings,
} from './gameAnalysisSettings';

describe('game-analysis settings', () => {
  it('defaults to the normal profile with no overrides', () => {
    const s = defaultGameAnalysisSettings();
    expect(s).toEqual({
      engine: 'stockfish',
      profile: 'normal',
      depthOverride: null,
      searchSeconds: null,
      threadsOverride: null,
    });
    // The default resolves to no override (historical identity preserved).
    expect(resolvedGameAnalysisConfig(s)).toEqual({ profile: 'normal' });
  });

  it('clamps depth overrides, search times and thread overrides', () => {
    expect(clampGameAnalysisDepth(0)).toBe(1);
    expect(clampGameAnalysisDepth(400)).toBe(128);
    expect(clampGameAnalysisDepth(25)).toBe(25);
    expect(clampGameAnalysisSearchSeconds(0.4)).toBe(1);
    expect(clampGameAnalysisSearchSeconds(3)).toBe(3);
    expect(clampGameAnalysisThreads(0, 2)).toBe(1);
    expect(clampGameAnalysisThreads(9, 2)).toBe(2);
    expect(clampGameAnalysisThreads(2, 2)).toBe(2);
    expect(clampGameAnalysisThreads(1, 2)).toBe(1);
  });

  it('exposes each profile depth for the Settings copy', () => {
    expect(gameAnalysisProfileDepth('fast')).toBe(10);
    expect(gameAnalysisProfileDepth('normal')).toBe(20);
    expect(gameAnalysisProfileDepth('deep')).toBe(30);
  });

  it('resolves overrides only when explicitly set', () => {
    const withDepth: GameAnalysisSettings = {
      ...defaultGameAnalysisSettings(),
      depthOverride: 25,
    };
    expect(resolvedGameAnalysisConfig(withDepth)).toEqual({ profile: 'normal', maxDepth: 25 });

    const withTime: GameAnalysisSettings = {
      ...defaultGameAnalysisSettings(),
      searchSeconds: 3,
    };
    expect(resolvedGameAnalysisConfig(withTime)).toEqual({
      profile: 'normal',
      movetimeMs: 3000,
    });

    const both: GameAnalysisSettings = {
      ...defaultGameAnalysisSettings(),
      profile: 'deep',
      depthOverride: 40,
      searchSeconds: 5,
    };
    expect(resolvedGameAnalysisConfig(both)).toEqual({
      profile: 'deep',
      maxDepth: 40,
      movetimeMs: 5000,
    });
  });

  it('carries the resolved overrides in the run config and identity contract', () => {
    // A default run has no override: identity/cache stay the historical key.
    expect(gameAnalysisOverrides(defaultGameAnalysisSettings())).toBeUndefined();
    expect(gameAnalysisRunOf(defaultGameAnalysisSettings())).toEqual({ profile: 'normal' });

    const withDepth: GameAnalysisSettings = {
      ...defaultGameAnalysisSettings(),
      depthOverride: 25,
    };
    expect(gameAnalysisOverrides(withDepth)).toEqual({ maxDepth: 25 });
    expect(gameAnalysisRunOf(withDepth)).toEqual({ profile: 'normal', config: { maxDepth: 25 } });
    expect(expectedGameAnalysisConfig(withDepth)).toEqual({
      profile: 'normal',
      config: { maxDepth: 25 },
    });

    // Search time is stored in seconds and resolved to milliseconds; a threads
    // override of 1 is the single-thread default and never an override.
    const resolved: GameAnalysisSettings = {
      ...defaultGameAnalysisSettings(),
      profile: 'deep',
      searchSeconds: 3,
      threadsOverride: 1,
    };
    expect(gameAnalysisOverrides(resolved)).toEqual({ movetimeMs: 3000 });
    expect(expectedGameAnalysisConfig(resolved)).toEqual({
      profile: 'deep',
      config: { movetimeMs: 3000 },
    });

    const threaded: GameAnalysisSettings = {
      ...defaultGameAnalysisSettings(),
      threadsOverride: 2,
    };
    expect(gameAnalysisOverrides(threaded)).toEqual({ threads: 2 });
    expect(gameAnalysisRunOf(threaded)).toEqual({
      profile: 'normal',
      config: { threads: 2 },
    });
  });
});
