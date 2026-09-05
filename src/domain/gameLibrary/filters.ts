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
/** Analysis-result single-select dimensions (Feature 010 milestone). */
export type AnalysisFilter = 'all' | 'analyzed' | 'notAnalyzed';
export type HasCountFilter = 'all' | 'yes' | 'no';

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
  // Analysis-result dimensions (registered by the Feature-010 milestone,
  // features/010-tactical-detection.md "Game Library Integration").
  readonly analysis: AnalysisFilter;
  readonly hasBlunders: HasCountFilter;
  readonly hasMissedTactics: HasCountFilter;
}

export const DEFAULT_LIBRARY_FILTERS: GameLibraryFilters = {
  search: '',
  timeFrame: { preset: 'all' },
  timeControl: 'all',
  side: 'all',
  platform: 'all',
  analysis: 'all',
  hasBlunders: 'all',
  hasMissedTactics: 'all',
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
    a.platform === b.platform &&
    a.analysis === b.analysis &&
    a.hasBlunders === b.hasBlunders &&
    a.hasMissedTactics === b.hasMissedTactics
  );
}

export function libraryFiltersActive(filters: GameLibraryFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.timeFrame.preset !== 'all' ||
    filters.timeControl !== 'all' ||
    filters.side !== 'all' ||
    filters.platform !== 'all' ||
    filters.analysis !== 'all' ||
    filters.hasBlunders !== 'all' ||
    filters.hasMissedTactics !== 'all'
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
  analysis: 'an',
  hasBlunders: 'hb',
  hasMissedTactics: 'hm',
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

function isAnalysisFilter(value: string): value is AnalysisFilter {
  return value === 'all' || value === 'analyzed' || value === 'notAnalyzed';
}

function isHasCountFilter(value: string): value is HasCountFilter {
  return value === 'all' || value === 'yes' || value === 'no';
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
  const analysis = params.get(QUERY_KEYS.analysis) ?? 'all';
  const hasBlunders = params.get(QUERY_KEYS.hasBlunders) ?? 'all';
  const hasMissedTactics = params.get(QUERY_KEYS.hasMissedTactics) ?? 'all';
  return {
    search,
    timeFrame: parseTimeFrame(params),
    timeControl: isTimeControlCategory(timeControl) ? timeControl : 'all',
    side: isSideFilter(side) ? side : 'all',
    platform: isPlatformFilter(platform) ? platform : 'all',
    analysis: isAnalysisFilter(analysis) ? analysis : 'all',
    hasBlunders: isHasCountFilter(hasBlunders) ? hasBlunders : 'all',
    hasMissedTactics: isHasCountFilter(hasMissedTactics) ? hasMissedTactics : 'all',
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
  if (filters.analysis !== 'all') put(QUERY_KEYS.analysis, filters.analysis);
  if (filters.hasBlunders !== 'all') put(QUERY_KEYS.hasBlunders, filters.hasBlunders);
  if (filters.hasMissedTactics !== 'all')
    put(QUERY_KEYS.hasMissedTactics, filters.hasMissedTactics);
  return params;
}

/** A single-dimension clear helper; clears everything when `key` is undefined. */
export function clearDimension(
  filters: GameLibraryFilters,
  key:
    | 'search'
    | 'timeFrame'
    | 'timeControl'
    | 'side'
    | 'platform'
    | 'analysis'
    | 'hasBlunders'
    | 'hasMissedTactics',
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
    case 'analysis':
      return { ...filters, analysis: 'all' };
    case 'hasBlunders':
      return { ...filters, hasBlunders: 'all' };
    case 'hasMissedTactics':
      return { ...filters, hasMissedTactics: 'all' };
  }
}
