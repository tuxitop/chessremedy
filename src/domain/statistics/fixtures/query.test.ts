import { afterEach, describe, expect, it } from 'vitest';
import {
  PRODUCTION_PLATFORMS,
  isProductionPlatform,
  matchesStatisticsDimensions,
  partitionGames,
  resolveStatisticsQuery,
  validateStatisticsQuery,
} from '../query';
import type { StatisticsQuery } from '../types';
import { sixTimeControlsScenario, platformsScenario } from './scenarios';

const DEFAULT_TZ = process.env.TZ;
process.env.TZ = 'UTC';

afterEach(() => {
  process.env.TZ = DEFAULT_TZ ?? 'UTC';
});

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const ALL_QUERY: StatisticsQuery = {
  platform: 'all',
  timeControl: 'all',
  side: 'all',
  result: 'all',
  dateRange: { preset: 'all' },
  now: NOW,
};

describe('validateStatisticsQuery', () => {
  it('rejects a malformed custom date', () => {
    const result = validateStatisticsQuery({
      ...ALL_QUERY,
      dateRange: { preset: 'custom', from: '2026-13-01', to: '2026-12-31' },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid-date-range',
      message: 'Invalid date — use yyyy-mm-dd.',
    });
  });

  it('rejects from > to', () => {
    const result = validateStatisticsQuery({
      ...ALL_QUERY,
      dateRange: { preset: 'custom', from: '2026-12-31', to: '2026-01-01' },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid-date-range',
      message: 'The start date must not be after the end date.',
    });
  });

  it('accepts valid custom dates and presets', () => {
    expect(
      validateStatisticsQuery({
        ...ALL_QUERY,
        dateRange: { preset: 'custom', from: '2026-01-01', to: '2026-12-31' },
      }),
    ).toEqual({ ok: true });
    expect(validateStatisticsQuery(ALL_QUERY)).toEqual({ ok: true });
  });
});

describe('resolveStatisticsQuery', () => {
  it('resolves the canonical local window through resolveTimeFrame', () => {
    const resolved = resolveStatisticsQuery({
      ...ALL_QUERY,
      dateRange: { preset: 'custom', from: '2026-09-01', to: '2026-09-02' },
    });
    expect(resolved.window.fromMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0));
    expect(resolved.window.toMs).toBe(Date.UTC(2026, 8, 2, 23, 59, 59, 999));
  });
});

describe('matchesStatisticsDimensions', () => {
  it('ANDs platform, time control, side, result and the date window', () => {
    const [game] = sixTimeControlsScenario().games;
    expect(game).toBeDefined();
    expect(matchesStatisticsDimensions(game!, ALL_QUERY)).toBe(true);
    expect(matchesStatisticsDimensions(game!, { ...ALL_QUERY, side: 'black' })).toBe(false);
    expect(matchesStatisticsDimensions(game!, { ...ALL_QUERY, result: 'blackWins' })).toBe(false);
    expect(matchesStatisticsDimensions(game!, { ...ALL_QUERY, result: 'whiteWins' })).toBe(true);
    expect(
      matchesStatisticsDimensions(game!, {
        ...ALL_QUERY,
        dateRange: { preset: 'custom', from: '2026-01-01', to: '2026-01-02' },
      }),
    ).toBe(false);
  });
});

describe('partitionGames — anti-combination', () => {
  it('returns one concrete partition per time control when timeControl is all', () => {
    const { games } = sixTimeControlsScenario();
    const partitions = partitionGames(games, ALL_QUERY);
    expect(partitions).toHaveLength(6);
    expect(partitions.every((partition) => !partition.combined)).toBe(true);
    expect(partitions.map((partition) => partition.timeControl)).toEqual([
      'bullet',
      'blitz',
      'rapid',
      'classical',
      'correspondence',
      'unknown',
    ]);
  });

  it('never combines speed-sensitive metrics even with combine: true', () => {
    const { games } = sixTimeControlsScenario();
    const partitions = partitionGames(games, { ...ALL_QUERY, combine: true }, 'speedSensitive');
    expect(partitions).toHaveLength(6);
    expect(partitions.every((partition) => !partition.combined)).toBe(true);
  });

  it('combines activity counts explicitly and keeps unknown/correspondence separate', () => {
    const { games } = sixTimeControlsScenario();
    const partitions = partitionGames(games, { ...ALL_QUERY, combine: true }, 'activity');
    expect(partitions).toHaveLength(3);
    const merged = partitions.find((partition) => partition.combined);
    expect(merged).toBeDefined();
    expect(merged?.platform).toBe('all');
    expect(merged?.timeControl).toBe('all');
    expect(merged?.games).toHaveLength(4);
    const separate = partitions.filter((partition) => !partition.combined);
    expect(separate.map((partition) => partition.timeControl).sort()).toEqual([
      'correspondence',
      'unknown',
    ]);
  });

  it('keeps Lichess and Chess.com separate when platform is all', () => {
    const { games } = platformsScenario();
    const partitions = partitionGames(games, ALL_QUERY);
    expect(partitions).toHaveLength(2);
    expect(partitions.map((partition) => partition.platform)).toEqual(['lichess', 'chesscom']);
  });

  it('returns a single concrete partition for a fully specified query', () => {
    const { games } = sixTimeControlsScenario();
    const partitions = partitionGames(games, {
      ...ALL_QUERY,
      platform: 'lichess',
      timeControl: 'blitz',
    });
    expect(partitions).toHaveLength(1);
    expect(partitions[0]?.games).toHaveLength(1);
  });
});

describe('production platform set', () => {
  it('excludes fixture and includes lichess/chesscom/local', () => {
    expect(PRODUCTION_PLATFORMS).toEqual(['lichess', 'chesscom', 'local']);
    expect(isProductionPlatform('fixture')).toBe(false);
    expect(isProductionPlatform('lichess')).toBe(true);
    expect(isProductionPlatform('local')).toBe(true);
  });
});
