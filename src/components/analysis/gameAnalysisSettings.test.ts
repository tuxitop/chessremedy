import { describe, expect, it } from 'vitest';
import {
  clampGameAnalysisDepth,
  clampGameAnalysisSearchSeconds,
  defaultGameAnalysisSettings,
  gameAnalysisProfileDepth,
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
    });
    // The default resolves to no override (historical identity preserved).
    expect(resolvedGameAnalysisConfig(s)).toEqual({ profile: 'normal' });
  });

  it('clamps depth overrides and search times', () => {
    expect(clampGameAnalysisDepth(0)).toBe(1);
    expect(clampGameAnalysisDepth(400)).toBe(128);
    expect(clampGameAnalysisDepth(25)).toBe(25);
    expect(clampGameAnalysisSearchSeconds(0.4)).toBe(1);
    expect(clampGameAnalysisSearchSeconds(3)).toBe(3);
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
});
