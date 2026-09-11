/**
 * Feature 014 — rating histories and rating trends (pure).
 *
 * Rating points are derived from the stored user-side `Player.rating` on each
 * game. Histories are always scoped to one concrete `(platform, timeControl)`
 * pair: Lichess and Chess.com, and every time-control category, stay separate
 * (never averaged, converted or combined). A missing rating yields no point;
 * there is no carry-forward. A rating trend point is the latest rated game
 * within the period; periods with no rated game are `empty`.
 *
 * No React, Dexie, Worker or engine import.
 */

import type { GameSource } from '@/domain/chess/gameSource';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { TimeWindow } from '@/domain/gameLibrary/timeframe';
import { PRODUCTION_PLATFORMS, matchesStatisticsDimensions } from './query';
import { buildTrendSeries } from './trends';
import type { TrendObservation } from './trends';
import { STATISTICS_VERSION } from './types';
import type {
  RatingHistory,
  RatingPoint,
  StatisticsGameRow,
  StatisticsQuery,
  TrendGranularity,
  TrendSeries,
  VersionSummary,
} from './types';
import { buildVersionSummary } from './version';

const PLATFORM_RANK: ReadonlyMap<GameSource, number> = new Map(
  PRODUCTION_PLATFORMS.map((platform, index) => [platform, index]),
);

const TIME_CONTROL_RANK: ReadonlyMap<TimeControlCategory, number> = new Map(
  TIME_CONTROL_CATEGORIES.map((category, index) => [category, index]),
);

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function playedAtMs(row: StatisticsGameRow): number | null {
  if (row.playedAt === null) {
    return null;
  }
  const ms = Date.parse(row.playedAt);
  return Number.isFinite(ms) ? ms : null;
}

function comparePoints(a: RatingPoint, b: RatingPoint): number {
  return Date.parse(a.playedAt) - Date.parse(b.playedAt) || compareText(a.gameId, b.gameId);
}

interface RatingGroup {
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  readonly points: RatingPoint[];
}

function compareGroups(a: RatingGroup, b: RatingGroup): number {
  const platformRank =
    (PLATFORM_RANK.get(a.platform) ?? Number.MAX_SAFE_INTEGER) -
    (PLATFORM_RANK.get(b.platform) ?? Number.MAX_SAFE_INTEGER);
  if (platformRank !== 0) {
    return platformRank;
  }
  const timeControlRank =
    (TIME_CONTROL_RANK.get(a.timeControl) ?? Number.MAX_SAFE_INTEGER) -
    (TIME_CONTROL_RANK.get(b.timeControl) ?? Number.MAX_SAFE_INTEGER);
  if (timeControlRank !== 0) {
    return timeControlRank;
  }
  return compareText(a.platform, b.platform) || compareText(a.timeControl, b.timeControl);
}

/**
 * One rating history per concrete `(platform, timeControl)` pair with rated,
 * dated games. Rows are filtered by the query dimensions/window; points are
 * chronological and deterministic. A pair with no rated game is omitted (no
 * empty history is fabricated).
 */
export function ratingHistories(
  rows: readonly StatisticsGameRow[],
  query: StatisticsQuery,
  versions: VersionSummary = buildVersionSummary(),
): readonly RatingHistory[] {
  const groups = new Map<string, RatingGroup>();
  for (const row of rows) {
    if (row.userRating === null || playedAtMs(row) === null) {
      continue;
    }
    if (!matchesStatisticsDimensions(row, query)) {
      continue;
    }
    const key = `${row.source}\u0000${row.normalizedTimeControl}`;
    let group = groups.get(key);
    if (!group) {
      group = { platform: row.source, timeControl: row.normalizedTimeControl, points: [] };
      groups.set(key, group);
    }
    group.points.push({
      gameId: row.id,
      playedAt: row.playedAt!,
      rating: row.userRating,
    });
  }

  const ordered = [...groups.values()].sort(compareGroups);
  return ordered.map((group) => ({
    platform: group.platform,
    timeControl: group.timeControl,
    points: [...group.points].sort(comparePoints),
    statisticsVersion: STATISTICS_VERSION,
    versions,
  }));
}

/** Inputs for one concrete rating trend series. */
export interface RatingTrendInput {
  readonly rows: readonly StatisticsGameRow[];
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  readonly granularity: TrendGranularity;
  readonly window: TimeWindow;
  readonly versions: VersionSummary;
}

/**
 * Rating trend for one concrete `(platform, timeControl)`: each period's
 * point is the latest rated game within that period (no carry-forward).
 */
export function ratingTrendSeries(input: RatingTrendInput): TrendSeries {
  const { rows, platform, timeControl, granularity, window, versions } = input;
  const observations: TrendObservation[] = rows
    .filter((row) => row.source === platform && row.normalizedTimeControl === timeControl)
    .map((row) => ({
      gameId: row.id,
      playedAt: row.playedAt,
      analysisId: null,
      userRating: row.userRating,
      accuracy: null,
      accuracyMoves: 0,
      classificationCounts: null,
      missedTactics: null,
    }));
  return buildTrendSeries({
    metric: 'rating',
    granularity,
    observations,
    platform,
    timeControl,
    window,
    versions,
  });
}
