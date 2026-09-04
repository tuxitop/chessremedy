/**
 * Import filters (Feature 007).
 *
 * Pure, deterministic selection model used by both providers when a user
 * imports a batch of games: a **time frame** (all time, a recent preset
 * window, or a custom from–to date range) plus a **time-control category**
 * selection. The authoritative category filter always evaluates a record's
 * verbatim time-control string through `normalizeTimeControl` (ADR-013), so
 * semantics are identical on Chess.com and Lichess.
 *
 * Filters belong to an import run and are stored on the import job: a run
 * whose filters differ from the stored job's triggers a re-sweep, identical
 * filters resume from the stored cursor.
 */

import type { TimeControlCategory } from '@/domain/chess/timeControl';

/** Concrete categories a user may select; `unknown` is never selectable. */
export const IMPORT_FILTER_CATEGORIES = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'correspondence',
] as const;

export type ImportFilterCategory = (typeof IMPORT_FILTER_CATEGORIES)[number];

const IMPORT_FILTER_CATEGORY_SET = new Set<string>(IMPORT_FILTER_CATEGORIES);

export const TIME_FRAME_PRESETS = ['all', 'last30d', 'last3m', 'last6m', 'last12m'] as const;
export type TimeFramePreset = (typeof TIME_FRAME_PRESETS)[number];

export type TimeFrame =
  | { readonly preset: TimeFramePreset }
  | { readonly preset: 'custom'; readonly from: string; readonly to: string };

export type TimeControlSelection =
  | { readonly kind: 'all' }
  | { readonly kind: 'categories'; readonly categories: readonly ImportFilterCategory[] };

export interface ImportFilters {
  readonly timeFrame: TimeFrame;
  readonly timeControls: TimeControlSelection;
}

export const DEFAULT_IMPORT_FILTERS: ImportFilters = {
  timeFrame: { preset: 'all' },
  timeControls: { kind: 'all' },
};

/** Resolved date window in epoch ms; `null` bound means "unbounded". */
export interface TimeWindow {
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

export type ImportFiltersValidationError =
  'invalidDate' | 'fromAfterTo' | 'emptyCategories' | 'unknownCategory';

export const MS_PER_DAY = 86_400_000;
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PRESET_OFFSET_MS: Readonly<Record<TimeFramePreset, number | null>> = {
  all: null,
  last30d: 30 * MS_PER_DAY,
  last3m: 3 * MS_PER_MONTH,
  last6m: 6 * MS_PER_MONTH,
  last12m: MS_PER_YEAR,
};

/** Validate a `yyyy-mm-dd` calendar date (not just the shape). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Milliseconds at UTC midnight for a validated `yyyy-mm-dd` date. */
export function isoDateToMs(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

export function isCustomTimeFrame(
  frame: TimeFrame,
): frame is Extract<TimeFrame, { preset: 'custom' }> {
  return frame.preset === 'custom';
}

/**
 * Resolve a `TimeFrame` against `nowMs` into an inclusive ms window.
 * `all` yields an unbounded window; presets run backwards from `nowMs`;
 * a custom range covers the whole UTC days from `from` through `to`.
 */
export function resolveTimeFrame(frame: TimeFrame, nowMs: number): TimeWindow {
  if (isCustomTimeFrame(frame)) {
    return { fromMs: isoDateToMs(frame.from), toMs: isoDateToMs(frame.to) + MS_PER_DAY - 1 };
  }
  const offset = PRESET_OFFSET_MS[frame.preset];
  if (offset === null) {
    return { fromMs: null, toMs: null };
  }
  return { fromMs: nowMs - offset, toMs: nowMs };
}

/** True when an ISO-8601 UTC instant falls inside the window (inclusive). */
export function playedAtInWindow(playedAtIso: string | null, window: TimeWindow): boolean {
  if (window.fromMs === null && window.toMs === null) {
    return true;
  }
  if (playedAtIso === null) {
    return false;
  }
  const time = Date.parse(playedAtIso);
  if (!Number.isFinite(time)) {
    return false;
  }
  if (window.fromMs !== null && time < window.fromMs) {
    return false;
  }
  if (window.toMs !== null && time > window.toMs) {
    return false;
  }
  return true;
}

/** True when `category` passes the `TimeControlSelection`. */
export function timeControlsMatch(
  selection: TimeControlSelection,
  category: TimeControlCategory,
): boolean {
  if (selection.kind === 'all') {
    return true;
  }
  return (selection.categories as readonly TimeControlCategory[]).includes(category);
}

export function validateTimeFrame(frame: TimeFrame): ImportFiltersValidationError | null {
  if (isCustomTimeFrame(frame)) {
    if (!isValidIsoDate(frame.from) || !isValidIsoDate(frame.to)) {
      return 'invalidDate';
    }
    if (frame.from > frame.to) {
      return 'fromAfterTo';
    }
  }
  return null;
}

export function validateTimeControlSelection(
  selection: TimeControlSelection,
): ImportFiltersValidationError | null {
  if (selection.kind === 'categories') {
    if (selection.categories.length === 0) {
      return 'emptyCategories';
    }
    for (const category of selection.categories) {
      if (!IMPORT_FILTER_CATEGORY_SET.has(category)) {
        return 'unknownCategory';
      }
    }
  }
  return null;
}

export function validateImportFilters(filters: ImportFilters): ImportFiltersValidationError | null {
  return validateTimeFrame(filters.timeFrame) ?? validateTimeControlSelection(filters.timeControls);
}

/** Order-insensitive category-set equality plus time-frame equality. */
export function filtersEqual(a: ImportFilters, b: ImportFilters): boolean {
  if (!timeFrameEqual(a.timeFrame, b.timeFrame)) {
    return false;
  }
  const aControls = a.timeControls;
  const bControls = b.timeControls;
  if (aControls.kind !== bControls.kind) {
    return false;
  }
  if (aControls.kind === 'all') {
    return true;
  }
  if (aControls.kind !== 'categories' || bControls.kind !== 'categories') {
    return false;
  }
  const setA = new Set<string>(aControls.categories);
  const setB = new Set<string>(bControls.categories);
  return setA.size === setB.size && [...setA].every((category) => setB.has(category));
}

function timeFrameEqual(a: TimeFrame, b: TimeFrame): boolean {
  if (isCustomTimeFrame(a) || isCustomTimeFrame(b)) {
    return isCustomTimeFrame(a) && isCustomTimeFrame(b) && a.from === b.from && a.to === b.to;
  }
  return a.preset === b.preset;
}
