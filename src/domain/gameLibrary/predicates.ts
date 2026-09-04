/**
 * Game Library filter predicates (Feature 007).
 *
 * ANDs every dimension. Equality filters run against stored normalized
 * fields (source, normalizedTimeControl, userColor); date filtering is an
 * inclusive local-time-zone window; search matches any field.
 */

import type { LibraryGameRow } from './index';
import type { GameLibraryFilters } from './filters';
import { matchesSearch } from './search';
import { playedAtInWindow, type TimeWindow } from './timeframe';

export function matchesLibraryFilters(
  row: LibraryGameRow,
  filters: GameLibraryFilters,
  window: TimeWindow,
): boolean {
  if (filters.platform !== 'all' && row.source !== filters.platform) {
    return false;
  }
  if (filters.timeControl !== 'all' && row.normalizedTimeControl !== filters.timeControl) {
    return false;
  }
  if (filters.side !== 'all' && row.userColor !== filters.side) {
    return false;
  }
  if (!playedAtInWindow(row.playedAt, window)) {
    return false;
  }
  if (!matchesSearch(row, filters.search)) {
    return false;
  }
  return true;
}
