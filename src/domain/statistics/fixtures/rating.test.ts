import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ratingHistories, ratingTrendSeries } from '../rating';
import type { StatisticsQuery } from '../types';
import { buildVersionSummary } from '../version';
import { game } from './builders';

const DEFAULT_TZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'UTC';
});

afterEach(() => {
  process.env.TZ = DEFAULT_TZ ?? 'UTC';
});

const VERSIONS = buildVersionSummary();
const QUERY: StatisticsQuery = {
  platform: 'all',
  timeControl: 'all',
  side: 'all',
  result: 'all',
  dateRange: { preset: 'all' },
  now: Date.UTC(2026, 0, 15, 12, 0, 0),
};

const ROWS = [
  game({
    id: 'l-rapid-2',
    source: 'lichess',
    normalizedTimeControl: 'rapid',
    playedAt: '2026-01-06T12:00:00.000Z',
    userRating: 1600,
  }),
  game({
    id: 'l-rapid-1',
    source: 'lichess',
    normalizedTimeControl: 'rapid',
    playedAt: '2026-01-05T12:00:00.000Z',
    userRating: 1500,
  }),
  game({
    id: 'c-rapid-1',
    source: 'chesscom',
    normalizedTimeControl: 'rapid',
    playedAt: '2026-01-05T12:00:00.000Z',
    userRating: 1200,
  }),
  game({
    id: 'l-blitz-1',
    source: 'lichess',
    normalizedTimeControl: 'blitz',
    playedAt: '2026-01-05T12:00:00.000Z',
    userRating: 1400,
  }),
  game({
    id: 'l-rapid-no-rating',
    source: 'lichess',
    normalizedTimeControl: 'rapid',
    playedAt: '2026-01-07T12:00:00.000Z',
    userRating: null,
  }),
  game({
    id: 'l-rapid-undated',
    source: 'lichess',
    normalizedTimeControl: 'rapid',
    playedAt: null,
    userRating: 1550,
  }),
];

describe('ratingHistories', () => {
  it('keeps one history per concrete platform + time control', () => {
    const histories = ratingHistories(ROWS, QUERY, VERSIONS);
    expect(histories.map((history) => [history.platform, history.timeControl])).toEqual([
      ['lichess', 'blitz'],
      ['lichess', 'rapid'],
      ['chesscom', 'rapid'],
    ]);
  });

  it('is chronological, excludes missing ratings and undated games, and carries no carry-forward', () => {
    const rapid = ratingHistories(ROWS, QUERY, VERSIONS).find(
      (history) => history.platform === 'lichess' && history.timeControl === 'rapid',
    );
    expect(rapid?.points).toEqual([
      { gameId: 'l-rapid-1', playedAt: '2026-01-05T12:00:00.000Z', rating: 1500 },
      { gameId: 'l-rapid-2', playedAt: '2026-01-06T12:00:00.000Z', rating: 1600 },
    ]);
  });

  it('never combines Lichess and Chess.com ratings', () => {
    const histories = ratingHistories(ROWS, { ...QUERY, platform: 'all' }, VERSIONS);
    expect(histories).toHaveLength(3);
    expect(histories.some((history) => history.platform === 'chesscom')).toBe(true);
    expect(histories.some((history) => history.platform === 'lichess')).toBe(true);
  });

  it('omits a pair with no rated game', () => {
    const histories = ratingHistories(
      [game({ id: 'local-1', source: 'local', userRating: null })],
      QUERY,
      VERSIONS,
    );
    expect(histories).toEqual([]);
  });
});

describe('ratingTrendSeries', () => {
  it('takes the latest rated game within the period and leaves gaps empty', () => {
    const series = ratingTrendSeries({
      rows: ROWS,
      platform: 'lichess',
      timeControl: 'rapid',
      granularity: 'week',
      window: {
        fromMs: Date.UTC(2026, 0, 5),
        toMs: Date.UTC(2026, 0, 18, 23, 59, 59, 999),
      },
      versions: VERSIONS,
    });
    expect(series.points.map((point) => point.periodKey)).toEqual(['2026-W02', '2026-W03']);
    expect(series.points[0]).toMatchObject({
      value: 1600,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(series.points[1]).toMatchObject({
      value: null,
      state: 'empty',
      sample: { unit: 'games', n: 0 },
    });
  });
});
