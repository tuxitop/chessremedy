/**
 * Feature 015 — dashboard query construction (pure, no React).
 *
 * Builds a canonical Feature-014 `StatisticsQuery` from the reused Game
 * Library filter state, validates a custom range (the inline hint) and reports
 * which dimensions are mixed. The Dashboard never merges partitions: `combine`
 * is omitted and `side`/`result` are pinned to `all` because they are not
 * surfaced.
 */

import { validateTimeFrame } from '@/domain/gameLibrary/timeframe';
import type { GameLibraryFilters } from '@/domain/gameLibrary/filters';
import type { StatisticsQuery } from '@/domain/statistics';

/**
 * Canonical statistics query for the dashboard filter bar. `platform`,
 * `timeControl` and `dateRange` come from the canonical `GameLibraryFilters`;
 * `side`/`result` are `all` and `combine` is never set (no silent merge).
 */
export function dashboardQueryFromFilters(
  filters: GameLibraryFilters,
  now: number,
): StatisticsQuery {
  return {
    platform: filters.platform,
    timeControl: filters.timeControl,
    side: 'all',
    result: 'all',
    dateRange: filters.timeFrame,
    now,
  };
}

/**
 * Inline validation hint for the current filters, or `null` when the range is
 * valid. An incomplete/invalid custom range has no queryable bounds yet.
 */
export function dashboardFilterHint(filters: GameLibraryFilters): string | null {
  return validateTimeFrame(filters.timeFrame);
}

/** True when the filters resolve to a queryable range. */
export function dashboardRangeValid(filters: GameLibraryFilters): boolean {
  return dashboardFilterHint(filters) === null;
}

/** Which dimensions of the current view are mixed (`all`). */
export interface MixedDimensions {
  readonly platform: boolean;
  readonly timeControl: boolean;
  readonly mixed: boolean;
  /** Human names of the mixed dimensions (`platforms`, `time controls`). */
  readonly labels: readonly string[];
}

/**
 * Describe the mixed dimensions of a view. `All` is always an explicit,
 * labeled, dimensioned view; partitions are never silently merged.
 */
export function mixedDimensions(filters: GameLibraryFilters): MixedDimensions {
  const labels: string[] = [];
  if (filters.platform === 'all') {
    labels.push('platforms');
  }
  if (filters.timeControl === 'all') {
    labels.push('time controls');
  }
  return {
    platform: filters.platform === 'all',
    timeControl: filters.timeControl === 'all',
    mixed: labels.length > 0,
    labels,
  };
}
