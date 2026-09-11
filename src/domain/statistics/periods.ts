/**
 * Feature 014 — local calendar period model (pure, hand-written).
 *
 * Day (`yyyy-mm-dd`), ISO-8601 week (`yyyy-Www`, Monday start, week 1
 * contains the first Thursday, week 53 when the ISO rule produces it) and
 * month (`yyyy-mm`) keys and inclusive local boundaries. All arithmetic is
 * done on local calendar dates so DST transitions never shift a boundary off
 * local midnight and never skip or duplicate a period. No date library.
 *
 * No React, Dexie, Worker or engine import.
 */

import { MS_PER_DAY, startOfLocalDayMs } from '@/domain/gameLibrary/timeframe';
import type { TrendGranularity } from './types';

/** One calendar period with its canonical key and inclusive local bounds. */
export interface Period {
  readonly key: string;
  /** Inclusive local period start (epoch ms). */
  readonly startMs: number;
  /** Inclusive local period end (epoch ms). */
  readonly endMs: number;
}

/** Upper bound guarding `enumeratePeriods` against an unbounded request. */
export const MAX_ENUMERATED_PERIODS = 100_000;

interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function localDateParts(ms: number): LocalDateParts {
  const date = new Date(ms);
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

/**
 * Whole-day index of a local calendar date, computed in UTC so the difference
 * between two dates is always an exact multiple of `MS_PER_DAY` (DST-safe).
 */
function dayIndex(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) / MS_PER_DAY;
}

/** ISO-8601 week-numbering year and week for a local calendar date. */
function isoWeekOf(ms: number): { readonly year: number; readonly week: number } {
  const { year, month, day } = localDateParts(ms);
  const index = dayIndex(year, month, day);
  // Monday = 0 … Sunday = 6.
  const weekday = (new Date(Date.UTC(year, month, day)).getUTCDay() + 6) % 7;
  // The Thursday of the current ISO week decides the ISO year.
  const thursdayIndex = index - weekday + 3;
  const isoYear = new Date(thursdayIndex * MS_PER_DAY).getUTCFullYear();
  // Week 1 is the week containing January 4th (always the first Thursday).
  const jan4Index = dayIndex(isoYear, 0, 4);
  const jan4Weekday = (new Date(jan4Index * MS_PER_DAY).getUTCDay() + 6) % 7;
  const firstThursdayIndex = jan4Index - jan4Weekday + 3;
  const week = Math.round((thursdayIndex - firstThursdayIndex) / 7) + 1;
  return { year: isoYear, week };
}

/** Canonical period key for an instant (`yyyy-mm-dd`, `yyyy-Www`, `yyyy-mm`). */
export function periodKeyOf(ms: number, granularity: TrendGranularity): string {
  const { year, month, day } = localDateParts(ms);
  switch (granularity) {
    case 'day':
      return `${year}-${pad2(month + 1)}-${pad2(day)}`;
    case 'month':
      return `${year}-${pad2(month + 1)}`;
    case 'week': {
      const iso = isoWeekOf(ms);
      return `${iso.year}-W${pad2(iso.week)}`;
    }
  }
}

/**
 * The period containing `ms`, with its key and inclusive local bounds.
 * Boundaries are whole local calendar units, so a DST-transition day is still
 * exactly one day (23 or 25 hours) and a week never skips a day.
 */
export function periodBoundsOf(ms: number, granularity: TrendGranularity): Period {
  const { year, month, day } = localDateParts(ms);
  let startMs: number;
  let nextStartMs: number;
  switch (granularity) {
    case 'day':
      startMs = startOfLocalDayMs(ms);
      nextStartMs = new Date(year, month, day + 1).getTime();
      break;
    case 'week': {
      const weekday = (new Date(year, month, day).getDay() + 6) % 7;
      startMs = new Date(year, month, day - weekday).getTime();
      nextStartMs = new Date(year, month, day - weekday + 7).getTime();
      break;
    }
    case 'month':
      startMs = new Date(year, month, 1).getTime();
      nextStartMs = new Date(year, month + 1, 1).getTime();
      break;
  }
  return { key: periodKeyOf(ms, granularity), startMs, endMs: nextStartMs - 1 };
}

/** Assign an ISO-8601 instant (or `null`) to its local period key. */
export function assignToPeriod(
  playedAtIso: string | null,
  granularity: TrendGranularity,
): string | null {
  if (playedAtIso === null) {
    return null;
  }
  const ms = Date.parse(playedAtIso);
  return Number.isFinite(ms) ? periodKeyOf(ms, granularity) : null;
}

/**
 * Every period covering the inclusive `[fromMs, toMs]` range, ascending.
 * Each period is a whole local calendar unit; a period with no observation is
 * still emitted (the caller renders it as an explicit empty gap). A reversed
 * or non-finite range yields no periods. Enumeration is capped at
 * `MAX_ENUMERATED_PERIODS` so an unbounded request cannot loop forever.
 */
export function enumeratePeriods(
  fromMs: number,
  toMs: number,
  granularity: TrendGranularity,
): readonly Period[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return [];
  }
  const periods: Period[] = [];
  const lastStartMs = periodBoundsOf(toMs, granularity).startMs;
  let cursor = periodBoundsOf(fromMs, granularity).startMs;
  while (cursor <= lastStartMs && periods.length < MAX_ENUMERATED_PERIODS) {
    const period = periodBoundsOf(cursor, granularity);
    periods.push(period);
    cursor = period.endMs + 1;
  }
  return periods;
}
