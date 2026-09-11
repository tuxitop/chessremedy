import { describe, expect, it } from 'vitest';
import { buildVersionSummary } from '@/domain/statistics';
import type { RatingHistory, TrendPoint, TrendSeries } from '@/domain/statistics';
import {
  mergeTrendSeries,
  ratingToChartPoints,
  trendDataKey,
  trendToChartPoints,
} from './chartPoints';

function point(
  periodKey: string,
  periodStart: number,
  state: TrendPoint['state'],
  value: number | null,
  n: number,
): TrendPoint {
  return {
    periodKey,
    periodStart,
    periodEnd: periodStart + 86_400_000,
    value,
    state,
    sample: { unit: 'games', n },
  };
}

function series(
  platform: TrendSeries['platform'],
  timeControl: TrendSeries['timeControl'],
  points: readonly TrendPoint[],
): TrendSeries {
  return {
    metric: 'accuracy',
    granularity: 'week',
    platform,
    timeControl,
    points,
    statisticsVersion: 1,
    versions: buildVersionSummary(),
  };
}

describe('trendToChartPoints', () => {
  it('preserves one slot per period and maps non-ok states to a null gap', () => {
    const mapped = trendToChartPoints(
      series('lichess', 'rapid', [
        point('w1', 0, 'ok', 80, 6),
        point('w2', 1, 'empty', null, 0),
        point('w3', 2, 'insufficient', 70, 3),
        point('w4', 3, 'notDetected', null, 0),
      ]),
    );
    expect(mapped.map((p) => p.periodKey)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(mapped.map((p) => p.value)).toEqual([80, null, null, null]);
    expect(mapped[0]).toMatchObject({ state: 'ok', n: 6, unit: 'games' });
    expect(mapped[1]).toMatchObject({ state: 'empty', n: 0 });
    expect(mapped[2]).toMatchObject({ state: 'insufficient', n: 3 });
  });
});

describe('mergeTrendSeries', () => {
  it('keeps partitions separate with one dataKey per concrete pair', () => {
    const lichess = series('lichess', 'rapid', [
      point('w1', 0, 'ok', 80, 6),
      point('w2', 1, 'empty', null, 0),
    ]);
    const chesscom = series('chesscom', 'rapid', [
      point('w1', 0, 'ok', 1500, 6),
      point('w2', 1, 'ok', 1510, 6),
    ]);
    const merged = mergeTrendSeries([lichess, chesscom]);
    expect(merged.series.map((s) => s.key)).toEqual(['lichess:rapid', 'chesscom:rapid']);
    expect(merged.rows).toHaveLength(2);
    expect(merged.rows[0]).toMatchObject({ periodKey: 'w1' });
    expect(merged.rows[0]!['lichess:rapid']).toBe(80);
    expect(merged.rows[0]!['chesscom:rapid']).toBe(1500);
    // The lichess gap stays a lichess gap; the chesscom value is untouched.
    expect(merged.rows[1]!['lichess:rapid']).toBeNull();
    expect(merged.rows[1]!['chesscom:rapid']).toBe(1510);
  });

  it('returns no rows for an empty series list', () => {
    expect(mergeTrendSeries([])).toEqual({ series: [], rows: [] });
  });

  it('builds a stable dataKey for a concrete partition', () => {
    expect(trendDataKey({ platform: 'chesscom', timeControl: 'blitz' })).toBe('chesscom:blitz');
  });
});

describe('ratingToChartPoints', () => {
  it('maps stored points to x/y with no interpolation', () => {
    const history: RatingHistory = {
      platform: 'lichess',
      timeControl: 'rapid',
      points: [
        { gameId: 'g1', playedAt: '2026-09-01T00:00:00.000Z', rating: 1500 },
        { gameId: 'g2', playedAt: '2026-09-08T00:00:00.000Z', rating: 1510 },
      ],
      statisticsVersion: 1,
      versions: buildVersionSummary(),
    };
    const mapped = ratingToChartPoints(history);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toEqual({ gameId: 'g1', x: Date.parse('2026-09-01T00:00:00.000Z'), y: 1500 });
    expect(mapped[1]).toEqual({ gameId: 'g2', x: Date.parse('2026-09-08T00:00:00.000Z'), y: 1510 });
  });

  it('skips an unparseable date rather than fabricating a point', () => {
    const history: RatingHistory = {
      platform: 'lichess',
      timeControl: 'rapid',
      points: [
        { gameId: 'g1', playedAt: 'not-a-date', rating: 1500 },
        { gameId: 'g2', playedAt: '2026-09-08T00:00:00.000Z', rating: 1510 },
      ],
      statisticsVersion: 1,
      versions: buildVersionSummary(),
    };
    expect(ratingToChartPoints(history)).toHaveLength(1);
  });
});
