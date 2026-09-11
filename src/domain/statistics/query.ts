/**
 * Feature 014 — query validation, dimensions and anti-combination partitioning
 * (pure).
 *
 * `StatisticsDateRange` resolution is delegated to the canonical Game Library
 * `resolveTimeFrame` (never re-implemented). `partitionGames` enforces the
 * anti-combination rule: when a dimension is `'all'` the result is dimensioned
 * per concrete `(platform, timeControl)`; a merged partition is produced only
 * for an explicit `combine: true` request whose metric class permits it, and
 * `unknown`/`correspondence` always stay separate.
 *
 * No React, Dexie, Worker or engine import.
 */

import { outcomeOf } from '@/domain/chess/game';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import {
  isCustomTimeFrame,
  isValidIsoDate,
  playedAtInWindow,
  resolveTimeFrame,
} from '@/domain/gameLibrary/timeframe';
import type { TimeWindow } from '@/domain/gameLibrary/timeframe';
import type {
  GamePartition,
  MetricClass,
  StatisticsGameRow,
  StatisticsQuery,
  StatisticsQueryError,
} from './types';

/**
 * Production platform presentation order (canonical: Lichess, Chess.com, then
 * additional sources). `fixture` is deliberately excluded.
 */
export const PRODUCTION_PLATFORMS = ['lichess', 'chesscom', 'local'] as const;

/** True for a platform that may appear in a production statistics result. */
export function isProductionPlatform(source: GameSource): boolean {
  return (PRODUCTION_PLATFORMS as readonly GameSource[]).includes(source);
}

/** Time-control categories that are always their own partition. */
const ALWAYS_SEPARATE_TIME_CONTROLS: ReadonlySet<TimeControlCategory> = new Set([
  'correspondence',
  'unknown',
]);

/**
 * Whether a metric class may be explicitly combined across time-control
 * categories. Only pure activity counts may; speed-sensitive metrics never
 * combine silently (and are not permitted to combine at all).
 */
export function combineAllowed(metricClass: MetricClass): boolean {
  return metricClass === 'activity';
}

/** Result of validating a statistics query. */
export type StatisticsQueryValidation = { readonly ok: true } | StatisticsQueryError;

/**
 * Validate the query's date range. Malformed custom dates and `from > to`
 * return a typed error; presets are always valid.
 */
export function validateStatisticsQuery(query: StatisticsQuery): StatisticsQueryValidation {
  const range = query.dateRange;
  if (!isCustomTimeFrame(range)) {
    return { ok: true };
  }
  if (!isValidIsoDate(range.from) || !isValidIsoDate(range.to)) {
    return { ok: false, reason: 'invalid-date-range', message: 'Invalid date — use yyyy-mm-dd.' };
  }
  if (range.from > range.to) {
    return {
      ok: false,
      reason: 'invalid-date-range',
      message: 'The start date must not be after the end date.',
    };
  }
  return { ok: true };
}

/** Resolved query window (inclusive local boundaries). */
export interface ResolvedStatisticsQuery {
  readonly window: TimeWindow;
}

/** Resolve the query's date range against its `now`. */
export function resolveStatisticsQuery(query: StatisticsQuery): ResolvedStatisticsQuery {
  return { window: resolveTimeFrame(query.dateRange, query.now) };
}

/** True when a game row matches every active query dimension (AND). */
export function matchesStatisticsDimensions(
  row: StatisticsGameRow,
  query: StatisticsQuery,
): boolean {
  if (query.platform !== 'all' && row.source !== query.platform) {
    return false;
  }
  if (query.timeControl !== 'all' && row.normalizedTimeControl !== query.timeControl) {
    return false;
  }
  if (query.side !== 'all' && row.userColor !== query.side) {
    return false;
  }
  if (query.result !== 'all' && outcomeOf(row.result) !== query.result) {
    return false;
  }
  return playedAtInWindow(row.playedAt, resolveTimeFrame(query.dateRange, query.now));
}

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

interface ConcreteGroup {
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  readonly games: StatisticsGameRow[];
}

function compareConcreteGroups(a: ConcreteGroup, b: ConcreteGroup): number {
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
 * Partition the matching games by concrete `(platform, timeControl)`.
 *
 * When `platform` and/or `timeControl` is `'all'`, one partition is returned
 * per concrete pair with observations. A merged partition is produced only
 * when `combine === true` and `combineAllowed(metricClass)` holds, and it
 * carries `combined: true`; `correspondence` and `unknown` are never merged.
 */
export function partitionGames(
  rows: readonly StatisticsGameRow[],
  query: StatisticsQuery,
  metricClass: MetricClass = 'speedSensitive',
): readonly GamePartition[] {
  const groups = new Map<string, ConcreteGroup>();
  for (const row of rows) {
    if (!matchesStatisticsDimensions(row, query)) {
      continue;
    }
    const key = `${row.source}\u0000${row.normalizedTimeControl}`;
    const existing = groups.get(key);
    if (existing) {
      existing.games.push(row);
    } else {
      groups.set(key, {
        platform: row.source,
        timeControl: row.normalizedTimeControl,
        games: [row],
      });
    }
  }
  const concrete = [...groups.values()].sort(compareConcreteGroups);

  const canCombine =
    query.combine === true &&
    combineAllowed(metricClass) &&
    (query.platform === 'all' || query.timeControl === 'all');

  if (!canCombine) {
    return concrete.map((group) => ({
      platform: group.platform,
      timeControl: group.timeControl,
      combined: false,
      games: group.games,
    }));
  }

  const mergeable = concrete.filter(
    (group) => !ALWAYS_SEPARATE_TIME_CONTROLS.has(group.timeControl),
  );
  const separate = concrete.filter((group) => ALWAYS_SEPARATE_TIME_CONTROLS.has(group.timeControl));
  const partitions: GamePartition[] = [];
  if (mergeable.length > 0) {
    partitions.push({
      platform: query.platform === 'all' ? 'all' : query.platform,
      timeControl: query.timeControl === 'all' ? 'all' : query.timeControl,
      combined: true,
      games: mergeable.flatMap((group) => group.games),
    });
  }
  for (const group of separate) {
    partitions.push({
      platform: group.platform,
      timeControl: group.timeControl,
      combined: false,
      games: group.games,
    });
  }
  return partitions;
}
