/**
 * Canonical Game Library filter state and URL codec (Feature 007).
 *
 * A single serializable state drives the whole page; the URL is the source
 * of truth so views are bookable/shareable/restorable
 * (specs/domain/game-library.md).
 */

import type { Color } from 'chessops/types';
import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import { isCustomTimeFrame, TIME_FRAME_PRESETS, type TimeFrame } from './timeframe';

export type LibraryPlatform = Extract<GameSource, 'lichess' | 'chesscom'>;

/** Platform choices are presented in canonical order: Lichess, Chess.com. */
export const LIBRARY_PLATFORMS: readonly LibraryPlatform[] = ['lichess', 'chesscom'];

export type PlatformFilter = 'all' | LibraryPlatform;
export type SideFilter = 'all' | Color;
export type TimeControlFilter = 'all' | TimeControlCategory;

export type NonCustomTimeFramePreset = Exclude<TimeFrame['preset'], 'custom'>;

/** Build a preset-only time frame (typed convenience for UI controls). */
export function presetTimeFrame(preset: NonCustomTimeFramePreset): TimeFrame {
  return { preset };
}

export interface GameLibraryFilters {
  readonly search: string;
  readonly timeFrame: TimeFrame;
  readonly timeControl: TimeControlFilter;
  readonly side: SideFilter;
  readonly platform: PlatformFilter;
}

export const DEFAULT_LIBRARY_FILTERS: GameLibraryFilters = {
  search: '',
  timeFrame: { preset: 'all' },
  timeControl: 'all',
  side: 'all',
  platform: 'all',
};

export function libraryFiltersEqual(a: GameLibraryFilters, b: GameLibraryFilters): boolean {
  return (
    a.search === b.search &&
    a.timeFrame.preset === b.timeFrame.preset &&
    (isCustomTimeFrame(a.timeFrame) && isCustomTimeFrame(b.timeFrame)
      ? a.timeFrame.from === b.timeFrame.from && a.timeFrame.to === b.timeFrame.to
      : a.timeFrame.preset === b.timeFrame.preset) &&
    a.timeControl === b.timeControl &&
    a.side === b.side &&
    a.platform === b.platform
  );
}

export function libraryFiltersActive(filters: GameLibraryFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.timeFrame.preset !== 'all' ||
    filters.timeControl !== 'all' ||
    filters.side !== 'all' ||
    filters.platform !== 'all'
  );
}

const QUERY_KEYS = {
  search: 'q',
  timeFrame: 'tf',
  from: 'from',
  to: 'to',
  timeControl: 'tc',
  side: 'side',
  platform: 'pl',
} as const;

function isTimeControlCategory(value: string): value is TimeControlCategory {
  const categories = new Set<TimeControlCategory>([
    'bullet',
    'blitz',
    'rapid',
    'classical',
    'correspondence',
    'unknown',
  ]);
  return categories.has(value as TimeControlCategory);
}

function isPlatformFilter(value: string): value is PlatformFilter {
  return value === 'all' || (LIBRARY_PLATFORMS as readonly string[]).includes(value);
}

function isSideFilter(value: string): value is SideFilter {
  return value === 'all' || value === 'white' || value === 'black';
}

type NonCustomTimeFrame = Exclude<TimeFrame, { readonly preset: 'custom' }>;

function parseTimeFrame(params: URLSearchParams): TimeFrame {
  const raw = params.get(QUERY_KEYS.timeFrame) ?? 'all';
  if (raw === 'custom') {
    const from = params.get(QUERY_KEYS.from) ?? '';
    const to = params.get(QUERY_KEYS.to) ?? '';
    return { preset: 'custom', from, to };
  }
  const preset = (TIME_FRAME_PRESETS as readonly string[]).includes(raw)
    ? (raw as NonCustomTimeFrame['preset'])
    : 'all';
  return { preset } as NonCustomTimeFrame;
}

export function filtersFromParams(params: URLSearchParams): GameLibraryFilters {
  const search = params.get(QUERY_KEYS.search) ?? '';
  const timeControl = params.get(QUERY_KEYS.timeControl) ?? 'all';
  const side = params.get(QUERY_KEYS.side) ?? 'all';
  const platform = params.get(QUERY_KEYS.platform) ?? 'all';
  return {
    search,
    timeFrame: parseTimeFrame(params),
    timeControl: isTimeControlCategory(timeControl) ? timeControl : 'all',
    side: isSideFilter(side) ? side : 'all',
    platform: isPlatformFilter(platform) ? platform : 'all',
  };
}

export function paramsFromFilters(filters: GameLibraryFilters): URLSearchParams {
  const params = new URLSearchParams();
  const put = (key: string, value: string): void => {
    if (value !== '') params.set(key, value);
  };
  put(QUERY_KEYS.search, filters.search);
  put(QUERY_KEYS.timeFrame, filters.timeFrame.preset);
  if (isCustomTimeFrame(filters.timeFrame)) {
    put(QUERY_KEYS.from, filters.timeFrame.from);
    put(QUERY_KEYS.to, filters.timeFrame.to);
  }
  if (filters.timeControl !== 'all') put(QUERY_KEYS.timeControl, filters.timeControl);
  if (filters.side !== 'all') put(QUERY_KEYS.side, filters.side);
  if (filters.platform !== 'all') put(QUERY_KEYS.platform, filters.platform);
  return params;
}

/** A single-dimension clear helper; clears everything when `key` is undefined. */
export function clearDimension(
  filters: GameLibraryFilters,
  key: 'search' | 'timeFrame' | 'timeControl' | 'side' | 'platform',
): GameLibraryFilters {
  switch (key) {
    case 'search':
      return { ...filters, search: '' };
    case 'timeFrame':
      return { ...filters, timeFrame: DEFAULT_LIBRARY_FILTERS.timeFrame };
    case 'timeControl':
      return { ...filters, timeControl: 'all' };
    case 'side':
      return { ...filters, side: 'all' };
    case 'platform':
      return { ...filters, platform: 'all' };
  }
}
