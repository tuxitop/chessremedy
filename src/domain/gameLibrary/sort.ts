/**
 * Game Library row sorting (Feature 007).
 *
 * V1 exposes only the default newest-first order (`playedAt` desc, null
 * last). The sort function is a single switch so future keys (rating,
 * opponent, result, time control, date ascending) can be added without
 * redesign; they are out of scope for V1 (specs/domain/game-library.md).
 */

import type { LibraryGameRow } from './index';

export type SortKey = 'dateDesc';

export function compareNewestFirst(a: LibraryGameRow, b: LibraryGameRow): number {
  const aMs = a.playedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(a.playedAt);
  const bMs = b.playedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(b.playedAt);
  if (aMs === bMs) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  return bMs - aMs;
}

export function sortLibraryRows(
  rows: readonly LibraryGameRow[],
  key: SortKey = 'dateDesc',
): LibraryGameRow[] {
  switch (key) {
    case 'dateDesc':
      return [...rows].sort(compareNewestFirst);
  }
}
