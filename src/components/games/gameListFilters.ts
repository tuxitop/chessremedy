/**
 * Games-page list display filters (Feature 007).
 *
 * Read-side filtering over the stored `GameSummary` read model — never PGN.
 * Applied client-side by a pure helper over a single full `listGameSummaries`
 * fetch (already ordered newest-first). These filters are independent of the
 * import filters and never touch a stored import job.
 */

import type { Color } from 'chessops/types';
import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { GameResult } from '@/domain/chess/game';

/** Minimal shape the filter needs; `GameSummary` satisfies it structurally. */
export interface GameListEntry {
  readonly source: GameSource;
  readonly normalizedTimeControl: TimeControlCategory;
  readonly result: GameResult;
  readonly userColor: Color;
  /** ISO-8601 UTC, or `null` when unknown. */
  readonly playedAt: string | null;
  readonly whitePlayer: { readonly name: string };
  readonly blackPlayer: { readonly name: string };
}

export type MultiOption<T extends string> = 'all' | readonly T[];

export interface GameListFilters {
  readonly sources: MultiOption<GameSource>;
  readonly timeControls: MultiOption<TimeControlCategory>;
  readonly colors: MultiOption<Color>;
  readonly results: MultiOption<GameResult>;
  /** Case-insensitive substring over the opponent's stored name. */
  readonly opponent: string;
  /** Inclusive `yyyy-mm-dd` bounds on the UTC date of `playedAt`. */
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
}

export const DEFAULT_GAME_LIST_FILTERS: GameListFilters = {
  sources: 'all',
  timeControls: 'all',
  colors: 'all',
  results: 'all',
  opponent: '',
  dateFrom: null,
  dateTo: null,
};

export function isAll<T extends string>(option: MultiOption<T>): option is 'all' {
  return option === 'all';
}

function includes<T extends string>(option: MultiOption<T>, value: T): boolean {
  return option === 'all' || (option as readonly T[]).includes(value);
}

/** The stored player on the side opposite `userColor` (never guessed). */
export function opponentName(entry: GameListEntry): string {
  return entry.userColor === 'white' ? entry.blackPlayer.name : entry.whitePlayer.name;
}

/** True when a summary passes every active display filter. */
export function matchesGameListFilters(entry: GameListEntry, filters: GameListFilters): boolean {
  if (!includes(filters.sources, entry.source)) {
    return false;
  }
  if (!includes(filters.timeControls, entry.normalizedTimeControl)) {
    return false;
  }
  if (!includes(filters.colors, entry.userColor)) {
    return false;
  }
  if (!includes(filters.results, entry.result)) {
    return false;
  }

  const opponent = filters.opponent.trim().toLowerCase();
  if (opponent !== '' && !opponentName(entry).toLowerCase().includes(opponent)) {
    return false;
  }

  if (filters.dateFrom !== null || filters.dateTo !== null) {
    if (entry.playedAt === null) {
      return false; // a dateless game never satisfies a date range
    }
    const date = entry.playedAt.slice(0, 10);
    if (filters.dateFrom !== null && date < filters.dateFrom) {
      return false;
    }
    if (filters.dateTo !== null && date > filters.dateTo) {
      return false;
    }
  }
  return true;
}

export function gameListFiltersActive(filters: GameListFilters): boolean {
  return (
    !isAll(filters.sources) ||
    !isAll(filters.timeControls) ||
    !isAll(filters.colors) ||
    !isAll(filters.results) ||
    filters.opponent.trim() !== '' ||
    filters.dateFrom !== null ||
    filters.dateTo !== null
  );
}
