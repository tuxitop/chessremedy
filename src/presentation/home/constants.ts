/**
 * Feature 018 — Home presentation constants (pure, no React).
 *
 * The bounded recent window every Home game-analysis read uses and the label
 * the cards show for it. The window is deliberately short (`last7d`) so the
 * entry page answers "how am I doing lately?" with a quick, recent insight
 * rather than an all-history average; it is never silently widened.
 */

import { startOfLocalDayMs, type TimeFrame } from '@/domain/gameLibrary/timeframe';

/** The bounded recent window Home queries and labels. */
export const HOME_STATS_WINDOW: TimeFrame = { preset: 'last7d' };

/** Human label of `HOME_STATS_WINDOW`, shown on every game-analysis card. */
export const HOME_STATS_WINDOW_LABEL = 'Last 7 days';

/** Label of the comparison window, used on the week-over-week deltas. */
export const HOME_PREVIOUS_WINDOW_LABEL = 'previous 7 days';

function localDateIso(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local calendar date `days` whole days before the day containing `now`. */
function shiftLocalDays(now: number, days: number): string {
  const date = new Date(startOfLocalDayMs(now));
  date.setDate(date.getDate() - days);
  return localDateIso(date.getTime());
}

/**
 * The 7-day window immediately preceding `HOME_STATS_WINDOW` for `now`, used to
 * show the week-over-week delta. It is non-overlapping with the current window
 * (days 0–6): it spans days 7–13, resolved as a custom inclusive range.
 */
export function homePreviousWindow(now: number): TimeFrame {
  return { preset: 'custom', from: shiftLocalDays(now, 13), to: shiftLocalDays(now, 7) };
}
