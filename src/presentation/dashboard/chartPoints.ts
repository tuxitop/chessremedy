/**
 * Feature 015 — chart-point mapping (pure, no React, no Recharts).
 *
 * Maps Feature-014 trend/rating results to plottable points. Trend points that
 * are not `ok` become explicit `null` gaps while their x-axis slot is
 * preserved; no value is computed and nothing is interpolated. Rating points
 * are the stored per-game points only (no interpolation or carry-forward).
 */

import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { MetricState, RatingHistory, SampleUnit, TrendSeries } from '@/domain/statistics';

/** One plottable trend point; `value` is `null` for a gap. */
export interface TrendChartPoint {
  readonly periodKey: string;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly value: number | null;
  readonly state: MetricState;
  readonly n: number;
  readonly unit: SampleUnit;
}

/**
 * Map a `TrendSeries` to chart points. One point per period is preserved
 * (gaps included); only `ok` points carry a value, every other state maps to
 * `value: null` while retaining `state`/`n` for the tooltip and data table.
 */
export function trendToChartPoints(series: TrendSeries): readonly TrendChartPoint[] {
  return series.points.map((point) => ({
    periodKey: point.periodKey,
    periodStart: point.periodStart,
    periodEnd: point.periodEnd,
    value: point.state === 'ok' ? point.value : null,
    state: point.state,
    n: point.sample.n,
    unit: point.sample.unit,
  }));
}

/** Stable dataKey for one concrete partition (`lichess:rapid`). */
export function trendDataKey(series: Pick<TrendSeries, 'platform' | 'timeControl'>): string {
  return `${series.platform}:${series.timeControl}`;
}

/** Metadata for one merged series (its dataKey + points). */
export interface MergedTrendSeries {
  readonly key: string;
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  readonly points: readonly TrendChartPoint[];
}

/**
 * One Recharts row: period identity (`periodKey`/`periodStart`/`periodEnd`)
 * plus one nullable value per partition dataKey.
 */
export type MergedTrendRow = Readonly<Record<string, number | string | null>>;

/** Merged trend rows plus the series metadata used to render each line. */
export interface MergedTrend {
  readonly series: readonly MergedTrendSeries[];
  readonly rows: readonly MergedTrendRow[];
}

/**
 * Merge several concrete trend series into Recharts rows keyed by `periodKey`.
 *
 * Every partition shares the same period enumeration (Feature 014 emits one
 * point per period for the resolved window), so a missing period is an
 * explicit per-series gap — partitions are never merged into one value and no
 * cross-partition arithmetic happens. The period order is ascending by
 * `periodStart` then `periodKey`.
 */
export function mergeTrendSeries(seriesList: readonly TrendSeries[]): MergedTrend {
  const series = seriesList.map((entry) => ({
    key: trendDataKey(entry),
    platform: entry.platform,
    timeControl: entry.timeControl,
    points: trendToChartPoints(entry),
  }));

  const slots = new Map<string, { periodKey: string; periodStart: number; periodEnd: number }>();
  for (const entry of series) {
    for (const point of entry.points) {
      if (!slots.has(point.periodKey)) {
        slots.set(point.periodKey, {
          periodKey: point.periodKey,
          periodStart: point.periodStart,
          periodEnd: point.periodEnd,
        });
      }
    }
  }

  const ordered = [...slots.values()].sort(
    (a, b) => a.periodStart - b.periodStart || compareText(a.periodKey, b.periodKey),
  );

  const pointsBySeries = series.map((entry) => ({
    key: entry.key,
    points: new Map(entry.points.map((point) => [point.periodKey, point.value])),
  }));

  const rows: MergedTrendRow[] = ordered.map((slot) => {
    const row: Record<string, number | string | null> = {
      periodKey: slot.periodKey,
      periodStart: slot.periodStart,
      periodEnd: slot.periodEnd,
    };
    for (const entry of pointsBySeries) {
      row[entry.key] = entry.points.get(slot.periodKey) ?? null;
    }
    return row;
  });

  return { series, rows };
}

/** One plottable rating point (per stored game, no interpolation). */
export interface RatingChartPoint {
  readonly gameId: string;
  /** Epoch ms of the stored `playedAt` (the x value). */
  readonly x: number;
  /** The stored user rating (the y value). */
  readonly y: number;
}

/**
 * Map a `RatingHistory` to chart points. Only the stored points are used;
 * a point with an unparseable date is skipped rather than fabricated (Feature
 * 014 already excludes undated games and missing ratings). No carry-forward.
 */
export function ratingToChartPoints(history: RatingHistory): readonly RatingChartPoint[] {
  const points: RatingChartPoint[] = [];
  for (const point of history.points) {
    const x = Date.parse(point.playedAt);
    if (!Number.isFinite(x)) {
      continue;
    }
    points.push({ gameId: point.gameId, x, y: point.rating });
  }
  return points;
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
