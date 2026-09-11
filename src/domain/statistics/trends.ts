/**
 * Feature 014 — trend series over local calendar periods (pure).
 *
 * One point per period in the resolved range, in ascending order, with
 * explicit `empty` gaps for periods that have no observation (never a
 * fabricated zero). Every point carries its canonical `Aggregate` (raw value,
 * state and honest sample). Period math is delegated to `periods.ts`; the
 * per-game values are read from the Stage-A `GameHistoryEntry` read model and
 * only aggregated here.
 *
 * No React, Dexie, Worker or engine import.
 */

import type { ClassificationCounts } from '@/domain/analysis/summary';
import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { TimeWindow } from '@/domain/gameLibrary/timeframe';
import {
  accuracyAggregate,
  aggregateOf,
  emptyAggregate,
  notDetectedAggregate,
  rate,
} from './aggregate';
import { enumeratePeriods, periodKeyOf } from './periods';
import { STATISTICS_VERSION } from './types';
import type {
  Aggregate,
  TrendGranularity,
  TrendMetric,
  TrendPoint,
  TrendSeries,
  VersionSummary,
} from './types';

/**
 * The minimal per-game observation a trend metric reads. Structurally
 * satisfied by `GameHistoryEntry`; `rating.ts` maps plain game rows to it with
 * the analysis fields nulled (a rating trend reads only `userRating`).
 */
export interface TrendObservation {
  readonly gameId: string;
  readonly playedAt: string | null;
  readonly analysisId: string | null;
  readonly userRating: number | null;
  readonly accuracy: number | null;
  readonly accuracyMoves: number;
  readonly classificationCounts: ClassificationCounts | null;
  readonly missedTactics: number | null;
}

/** Inputs for one trend series over an already-partitioned observation set. */
export interface BuildTrendSeriesInput {
  readonly metric: TrendMetric;
  /** Defaults to `week` (the Dashboard default). */
  readonly granularity?: TrendGranularity;
  readonly observations: readonly TrendObservation[];
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  /** Resolved query window; a `null` bound is derived from the observations. */
  readonly window: TimeWindow;
  readonly versions: VersionSummary;
}

function playedAtMs(observation: TrendObservation): number | null {
  if (observation.playedAt === null) {
    return null;
  }
  const ms = Date.parse(observation.playedAt);
  return Number.isFinite(ms) ? ms : null;
}

function analyzed(observations: readonly TrendObservation[]): TrendObservation[] {
  return observations.filter((observation) => observation.analysisId !== null);
}

function detected(observations: readonly TrendObservation[]): TrendObservation[] {
  return observations.filter((observation) => observation.missedTactics !== null);
}

function sumClassification(
  observations: readonly TrendObservation[],
  key: keyof ClassificationCounts,
): number {
  let total = 0;
  for (const observation of observations) {
    total += observation.classificationCounts?.[key] ?? 0;
  }
  return total;
}

/** Latest rated game within a period, tie-broken deterministically by id. */
function latestRated(observations: readonly TrendObservation[]): TrendObservation | null {
  let latest: TrendObservation | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const observation of observations) {
    if (observation.userRating === null) {
      continue;
    }
    const ms = playedAtMs(observation);
    if (ms === null) {
      continue;
    }
    if (
      latest === null ||
      ms > latestMs ||
      (ms === latestMs && observation.gameId > latest.gameId)
    ) {
      latest = observation;
      latestMs = ms;
    }
  }
  return latest;
}

function missedTacticsAggregate(period: readonly TrendObservation[], unit: 'games'): Aggregate {
  if (period.length === 0) {
    return emptyAggregate(unit);
  }
  const detectedObservations = detected(period);
  if (detectedObservations.length === 0) {
    return notDetectedAggregate(unit);
  }
  const total = detectedObservations.reduce(
    (sum, observation) => sum + (observation.missedTactics ?? 0),
    0,
  );
  return aggregateOf(total, detectedObservations.length, unit);
}

function missedTacticsRate(period: readonly TrendObservation[]): Aggregate {
  if (period.length === 0) {
    return emptyAggregate('games');
  }
  const detectedObservations = detected(period);
  if (detectedObservations.length === 0) {
    return notDetectedAggregate('games');
  }
  const total = detectedObservations.reduce(
    (sum, observation) => sum + (observation.missedTactics ?? 0),
    0,
  );
  return rate(total, detectedObservations.length, 'games');
}

function aggregateForMetric(metric: TrendMetric, period: readonly TrendObservation[]): Aggregate {
  const analyzedObservations = analyzed(period);
  switch (metric) {
    case 'gamesPlayed':
      return aggregateOf(period.length, period.length, 'games');
    case 'gamesAnalyzed':
      // Denominator is games played, so "games but none analyzed" is a real
      // zero rather than an indistinguishable `empty`.
      return aggregateOf(analyzedObservations.length, period.length, 'games');
    case 'accuracy':
      return accuracyAggregate(
        period.map((observation) => ({
          accuracy: observation.accuracy,
          weightMoves: observation.accuracyMoves,
        })),
      );
    case 'rating': {
      const latest = latestRated(period);
      if (latest === null) {
        return emptyAggregate('games');
      }
      const ratedCount = period.filter(
        (observation) => observation.userRating !== null && playedAtMs(observation) !== null,
      ).length;
      return aggregateOf(latest.userRating, ratedCount, 'games');
    }
    case 'inaccuracies':
      return aggregateOf(
        sumClassification(analyzedObservations, 'inaccuracy'),
        analyzedObservations.length,
        'games',
      );
    case 'mistakes':
      return aggregateOf(
        sumClassification(analyzedObservations, 'mistake'),
        analyzedObservations.length,
        'games',
      );
    case 'blunders':
      return aggregateOf(
        sumClassification(analyzedObservations, 'blunder'),
        analyzedObservations.length,
        'games',
      );
    case 'inaccuraciesPerGame':
      return rate(
        sumClassification(analyzedObservations, 'inaccuracy'),
        analyzedObservations.length,
        'games',
      );
    case 'mistakesPerGame':
      return rate(
        sumClassification(analyzedObservations, 'mistake'),
        analyzedObservations.length,
        'games',
      );
    case 'blundersPerGame':
      return rate(
        sumClassification(analyzedObservations, 'blunder'),
        analyzedObservations.length,
        'games',
      );
    case 'missedTactics':
      return missedTacticsAggregate(period, 'games');
    case 'missedTacticsPerGame':
      return missedTacticsRate(period);
  }
}

/**
 * Build a complete, ascending trend series for one concrete partition.
 *
 * When a window bound is `null` (the `all` preset) it is derived from the
 * observed `playedAt` min/max; no dated observations yields an empty series.
 * Periods with no observation are emitted with `empty`/`null`/`n = 0`.
 */
export function buildTrendSeries(input: BuildTrendSeriesInput): TrendSeries {
  const {
    metric,
    granularity = 'week',
    observations,
    platform,
    timeControl,
    window,
    versions,
  } = input;

  const dated: Array<{ readonly observation: TrendObservation; readonly ms: number }> = [];
  for (const observation of observations) {
    const ms = playedAtMs(observation);
    if (ms !== null) {
      dated.push({ observation, ms });
    }
  }

  let fromMs = window.fromMs;
  let toMs = window.toMs;
  if ((fromMs === null || toMs === null) && dated.length > 0) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const entry of dated) {
      if (entry.ms < min) {
        min = entry.ms;
      }
      if (entry.ms > max) {
        max = entry.ms;
      }
    }
    if (fromMs === null) {
      fromMs = min;
    }
    if (toMs === null) {
      toMs = max;
    }
  }

  const emptySeries = (): TrendSeries => ({
    metric,
    granularity,
    platform,
    timeControl,
    points: [],
    statisticsVersion: STATISTICS_VERSION,
    versions,
  });

  if (fromMs === null || toMs === null || fromMs > toMs) {
    return emptySeries();
  }

  const byPeriod = new Map<string, TrendObservation[]>();
  for (const entry of dated) {
    const key = periodKeyOf(entry.ms, granularity);
    const list = byPeriod.get(key);
    if (list) {
      list.push(entry.observation);
    } else {
      byPeriod.set(key, [entry.observation]);
    }
  }

  const points: TrendPoint[] = enumeratePeriods(fromMs, toMs, granularity).map((period) => {
    const aggregate = aggregateForMetric(metric, byPeriod.get(period.key) ?? []);
    return {
      periodKey: period.key,
      periodStart: period.startMs,
      periodEnd: period.endMs,
      value: aggregate.value,
      state: aggregate.state,
      sample: aggregate.sample,
    };
  });

  return {
    metric,
    granularity,
    platform,
    timeControl,
    points,
    statisticsVersion: STATISTICS_VERSION,
    versions,
  };
}
