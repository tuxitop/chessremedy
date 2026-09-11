/**
 * Feature 015 — dashboard presentation formatters (pure, no React).
 *
 * Number/percent/time/date formatting for the Dashboard. Every value that
 * already has a canonical Feature-009/Feature-013 formatter is delegated to
 * it; this module only owns the dashboard-specific shapes (sample labels,
 * `mm:ss`/`h:mm:ss`, deterministic local dates). Formatting is presentation
 * only — raw values are never rounded in the domain.
 */

import { formatAccuracy } from '@/domain/analysis/classificationMeta';
import { formatPercent } from '@/components/puzzles/cycles/labels';
import type { SampleUnit } from '@/domain/statistics';

/** Human label of a sample unit (singular when `n === 1`). */
const SAMPLE_UNIT_LABELS: Readonly<Record<SampleUnit, string>> = {
  games: 'games',
  moves: 'moves',
  puzzles: 'puzzles',
  cycles: 'cycles',
};

const SAMPLE_UNIT_SINGULAR: Readonly<Record<SampleUnit, string>> = {
  games: 'game',
  moves: 'move',
  puzzles: 'puzzle',
  cycles: 'cycle',
};

/** The em-dash used for an absent value (never a fabricated zero). */
export const EMPTY_VALUE_TEXT = '—';

/** Integer count (`1500` → `1500`); deterministic, locale-free. */
export function formatCount(value: number): string {
  return Math.round(value).toString();
}

/** Integer rating (`1516.4` → `1516`); deterministic, locale-free. */
export function formatRating(value: number): string {
  return Math.round(value).toString();
}

/**
 * Accuracy display: the canonical Feature-009 `formatAccuracy(value, decimals)`
 * with a trailing percent sign. A `null`/`undefined`/`NaN` value renders the
 * em-dash only (never `—%`).
 */
export function formatAccuracyDisplay(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return formatAccuracy(value, decimals);
  }
  return `${formatAccuracy(value, decimals)}%`;
}

/**
 * Percent value from a `[0, 1]` fraction (`0.6667` → `67%`). At the default
 * zero decimals this delegates to the canonical Feature-013 `formatPercent`;
 * a positive `decimals` keeps the requested precision.
 */
export function formatPercentValue(value: number, decimals = 0): string {
  if (decimals <= 0) {
    return formatPercent(value) ?? EMPTY_VALUE_TEXT;
  }
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Solving time as `mm:ss` under an hour, `h:mm:ss` at or above an hour.
 * `null`/non-finite renders the em-dash. Rounding is to the nearest second.
 */
export function formatDashboardTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return EMPTY_VALUE_TEXT;
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => value.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Deterministic local calendar date (`yyyy-mm-dd`); `null` renders the em-dash. */
export function formatDashboardDate(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return EMPTY_VALUE_TEXT;
  }
  const date = new Date(ms);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Sample-size label: `n = 4 games` (singular for `n === 1`). */
export function formatSample(n: number, unit: SampleUnit): string {
  const label = n === 1 ? SAMPLE_UNIT_SINGULAR[unit] : SAMPLE_UNIT_LABELS[unit];
  return `n = ${n} ${label}`;
}
