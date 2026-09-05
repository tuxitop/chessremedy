/**
 * Time-frame resolution for the Game Library (Feature 007).
 *
 * Dates are applied in the **user's local time zone**; `from` is inclusive
 * from 00:00:00.000 local and `to` is inclusive through the end of its local
 * day. Presets resolve backwards from a caller-supplied `now` in whole
 * calendar days/months. Pure and deterministic for a given `now` (tests run
 * under a pinned TZ plus explicit-offset cases).
 */

export const TIME_FRAME_PRESETS = [
  'all',
  'today',
  'last7d',
  'last30d',
  'last3m',
  'last6m',
  'lastYear',
] as const;

export type TimeFramePreset = (typeof TIME_FRAME_PRESETS)[number];

export type TimeFrame =
  | { readonly preset: TimeFramePreset }
  | { readonly preset: 'custom'; readonly from: string; readonly to: string };

/** Inclusive instant window; `null` bound means unbounded. */
export interface TimeWindow {
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

export const MS_PER_DAY = 86_400_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCustomTimeFrame(
  frame: TimeFrame,
): frame is Extract<TimeFrame, { preset: 'custom' }> {
  return frame.preset === 'custom';
}

/** Milliseconds at local midnight of a calendar date (`yyyy-mm-dd`). */
export function localDateToMs(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(year!, month! - 1, day!).getTime();
}

function localDateIso(ms: number): string {
  const date = new Date(ms);
  const pad = (v: number): string => v.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Local midnight (start of the local day containing `ms`). */
export function startOfLocalDayMs(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local date of `ms` shifted back `days` whole calendar days (local midnight). */
function daysAgoLocalMidnight(ms: number, days: number): number {
  const start = startOfLocalDayMs(ms);
  return new Date(start - days * MS_PER_DAY).getTime();
}

/** Local midnight of today's date shifted back `months` whole months (clamped). */
function monthsAgoLocalMidnight(ms: number, months: number): number {
  const now = new Date(startOfLocalDayMs(ms));
  const target = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), daysInTarget));
  return target.getTime();
}

export function validateTimeFrame(frame: TimeFrame): string | null {
  if (!isCustomTimeFrame(frame)) {
    return null;
  }
  if (frame.from === '' || frame.to === '') {
    return 'Choose both a start and an end date.';
  }
  if (!isValidIsoDate(frame.from) || !isValidIsoDate(frame.to)) {
    return 'Invalid date — use yyyy-mm-dd.';
  }
  if (frame.from > frame.to) {
    return 'The start date must not be after the end date.';
  }
  return null;
}

/**
 * Resolve a `TimeFrame` against `now` (epoch ms) into an inclusive local
 * window. Custom ranges span whole local days, inclusive at both ends.
 */
export function resolveTimeFrame(frame: TimeFrame, now: number): TimeWindow {
  if (isCustomTimeFrame(frame)) {
    const fromMs = localDateToMs(frame.from);
    const endOfDayMs = localDateToMs(frame.to) + MS_PER_DAY - 1;
    return { fromMs, toMs: endOfDayMs };
  }
  switch (frame.preset) {
    case 'all':
      return { fromMs: null, toMs: null };
    case 'today':
      return { fromMs: startOfLocalDayMs(now), toMs: now };
    case 'last7d':
      return { fromMs: daysAgoLocalMidnight(now, 6), toMs: now };
    case 'last30d':
      return { fromMs: daysAgoLocalMidnight(now, 29), toMs: now };
    case 'last3m':
      return { fromMs: monthsAgoLocalMidnight(now, 3), toMs: now };
    case 'last6m':
      return { fromMs: monthsAgoLocalMidnight(now, 6), toMs: now };
    case 'lastYear':
      return { fromMs: monthsAgoLocalMidnight(now, 12), toMs: now };
  }
}

/**
 * Convert an inclusive local window to exclusive UTC query instants for a
 * `playedBefore`/`playedAfter` style repository query (ISO strings).
 */
export function toExclusiveQueryInstants(window: TimeWindow): {
  playedAfter?: string;
  playedBefore?: string;
} {
  const query: { playedAfter?: string; playedBefore?: string } = {};
  if (window.fromMs !== null && Number.isFinite(window.fromMs)) {
    query.playedAfter = new Date(window.fromMs - 1).toISOString();
  }
  if (window.toMs !== null && Number.isFinite(window.toMs)) {
    query.playedBefore = new Date(window.toMs + 1).toISOString();
  }
  return query;
}

/** True when an ISO-8601 UTC instant falls inside the inclusive window. */
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

export function dateIsoOf(playedAtIso: string | null): string | null {
  if (playedAtIso === null) {
    return null;
  }
  const ms = Date.parse(playedAtIso);
  return Number.isFinite(ms) ? localDateIso(ms) : null;
}
