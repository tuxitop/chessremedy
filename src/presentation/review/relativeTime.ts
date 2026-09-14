/**
 * Feature 020 — relative next-due formatting (pure presentation helper).
 *
 * A small deterministic formatter for the review card's "Next review …" text.
 * Callers inject `now`; nothing reads a hidden clock.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Format the interval from `now` to `dueAt` as a relative phrase:
 * `"due now"`, `"in under a minute"`, `"in 4 days"`, `"in 2 months"`, etc.
 * A non-finite or past `dueAt` reads as `"due now"`.
 */
export function formatRelativeDue(dueAt: number, now: number): string {
  const diff = dueAt - now;
  if (!Number.isFinite(diff) || diff <= 0) {
    return 'due now';
  }
  if (diff < MINUTE_MS) {
    return 'in under a minute';
  }
  if (diff < HOUR_MS) {
    const minutes = Math.round(diff / MINUTE_MS);
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (diff < DAY_MS) {
    const hours = Math.round(diff / HOUR_MS);
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(diff / DAY_MS);
  if (days < 30) {
    return `in ${days} day${days === 1 ? '' : 's'}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `in ${months} month${months === 1 ? '' : 's'}`;
  }
  const years = Math.round(days / 365);
  return `in ${years} year${years === 1 ? '' : 's'}`;
}
