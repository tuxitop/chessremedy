import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrendMetric } from '../types';
import { buildTrendSeries, type TrendObservation } from '../trends';
import { buildVersionSummary } from '../version';

const DEFAULT_TZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'UTC';
});

afterEach(() => {
  process.env.TZ = DEFAULT_TZ ?? 'UTC';
});

const VERSIONS = buildVersionSummary();
const WINDOW = {
  fromMs: Date.UTC(2025, 11, 29),
  toMs: Date.UTC(2026, 0, 25, 23, 59, 59, 999),
};

function obs(overrides: Partial<TrendObservation> = {}): TrendObservation {
  return {
    gameId: 'g1',
    playedAt: '2026-01-01T12:00:00.000Z',
    analysisId: 'a1',
    userRating: 1500,
    accuracy: 90,
    accuracyMoves: 10,
    classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    missedTactics: 0,
    ...overrides,
  };
}

const G1 = obs({
  gameId: 'g1',
  playedAt: '2026-01-01T12:00:00.000Z',
  analysisId: 'a1',
  userRating: 1500,
  accuracy: 90,
  accuracyMoves: 10,
  classificationCounts: { best: 0, good: 0, inaccuracy: 2, mistake: 1, blunder: 0 },
  missedTactics: 0,
});
const G2 = obs({
  gameId: 'g2',
  playedAt: '2026-01-02T12:00:00.000Z',
  analysisId: 'a2',
  userRating: 1600,
  accuracy: 80,
  accuracyMoves: 30,
  classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
  missedTactics: 1,
});
const G3 = obs({
  gameId: 'g3',
  playedAt: '2026-01-13T12:00:00.000Z',
  analysisId: null,
  userRating: 1700,
  accuracy: null,
  accuracyMoves: 0,
  classificationCounts: null,
  missedTactics: null,
});
const OBSERVATIONS = [G1, G2, G3];

function series(metric: TrendMetric, observations: readonly TrendObservation[] = OBSERVATIONS) {
  return buildTrendSeries({
    metric,
    granularity: 'week',
    observations,
    platform: 'lichess',
    timeControl: 'rapid',
    window: WINDOW,
    versions: VERSIONS,
  });
}

function point(metric: TrendMetric, key: string, observations = OBSERVATIONS) {
  const found = series(metric, observations).points.find((entry) => entry.periodKey === key);
  expect(found).toBeDefined();
  return found!;
}

describe('buildTrendSeries — range and empty gaps', () => {
  it('emits every period ascending with explicit empty gaps', () => {
    const result = series('gamesPlayed');
    expect(result.points.map((entry) => entry.periodKey)).toEqual([
      '2026-W01',
      '2026-W02',
      '2026-W03',
      '2026-W04',
    ]);
    expect(point('gamesPlayed', '2026-W02')).toEqual({
      periodKey: '2026-W02',
      periodStart: Date.UTC(2026, 0, 5),
      periodEnd: Date.UTC(2026, 0, 11, 23, 59, 59, 999),
      value: null,
      state: 'empty',
      sample: { unit: 'games', n: 0 },
    });
  });

  it('derives the range from observations for the all preset', () => {
    const result = buildTrendSeries({
      metric: 'gamesPlayed',
      granularity: 'week',
      observations: OBSERVATIONS,
      platform: 'lichess',
      timeControl: 'rapid',
      window: { fromMs: null, toMs: null },
      versions: VERSIONS,
    });
    expect(result.points.map((entry) => entry.periodKey)).toEqual([
      '2026-W01',
      '2026-W02',
      '2026-W03',
    ]);
  });

  it('defaults to weekly granularity', () => {
    const result = buildTrendSeries({
      metric: 'gamesPlayed',
      observations: OBSERVATIONS,
      platform: 'lichess',
      timeControl: 'rapid',
      window: WINDOW,
      versions: VERSIONS,
    });
    expect(result.granularity).toBe('week');
    expect(result.points[0]?.periodKey).toBe('2026-W01');
  });

  it('returns an empty series when the all range has no dated observations', () => {
    const empty = buildTrendSeries({
      metric: 'gamesPlayed',
      granularity: 'week',
      observations: [],
      platform: 'lichess',
      timeControl: 'rapid',
      window: { fromMs: null, toMs: null },
      versions: VERSIONS,
    });
    expect(empty.points).toEqual([]);
    const undated = buildTrendSeries({
      metric: 'gamesPlayed',
      granularity: 'week',
      observations: [obs({ playedAt: null })],
      platform: 'lichess',
      timeControl: 'rapid',
      window: { fromMs: null, toMs: null },
      versions: VERSIONS,
    });
    expect(undated.points).toEqual([]);
  });
});

describe('buildTrendSeries — metric aggregates', () => {
  it('counts games played and analyzed with an honest denominator', () => {
    expect(point('gamesPlayed', '2026-W01').value).toBe(2);
    expect(point('gamesPlayed', '2026-W01').sample).toEqual({ unit: 'games', n: 2 });
    expect(point('gamesAnalyzed', '2026-W01')).toMatchObject({
      value: 2,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(point('gamesAnalyzed', '2026-W03')).toMatchObject({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'games', n: 1 },
    });
  });

  it('aggregates accuracy with the ADR-024 move weighting', () => {
    expect(point('accuracy', '2026-W01')).toMatchObject({
      value: (90 * 10 + 80 * 30) / 40,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(point('accuracy', '2026-W02').state).toBe('empty');
  });

  it('aggregates absolute counts and per-game rates', () => {
    expect(point('inaccuracies', '2026-W01')).toMatchObject({
      value: 2,
      sample: { unit: 'games', n: 2 },
    });
    expect(point('inaccuraciesPerGame', '2026-W01').value).toBe(1);
    expect(point('mistakesPerGame', '2026-W01').value).toBe(0.5);
    expect(point('blundersPerGame', '2026-W01').value).toBe(0.5);
    expect(point('inaccuraciesPerGame', '2026-W03').state).toBe('empty');
  });

  it('distinguishes notDetected from empty for missed tactics', () => {
    expect(point('missedTacticsPerGame', '2026-W01')).toMatchObject({
      value: 0.5,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(point('missedTacticsPerGame', '2026-W03')).toMatchObject({
      value: null,
      state: 'notDetected',
      sample: { unit: 'games', n: 0 },
    });
    expect(point('missedTactics', '2026-W02').state).toBe('empty');
    expect(point('missedTactics', '2026-W03').state).toBe('notDetected');
  });

  it('uses the latest rated game within the period for rating', () => {
    expect(point('rating', '2026-W01')).toMatchObject({
      value: 1600,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(point('rating', '2026-W02').state).toBe('empty');
  });

  it('is deterministic for identical inputs', () => {
    expect(JSON.stringify(series('blunders'))).toBe(JSON.stringify(series('blunders')));
  });
});
