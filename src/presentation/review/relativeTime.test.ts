import { describe, expect, it } from 'vitest';
import { formatRelativeDue } from './relativeTime';

const NOW = new Date(2023, 10, 14, 12, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeDue', () => {
  it('reads a past or non-finite due instant as due now', () => {
    expect(formatRelativeDue(NOW - 1, NOW)).toBe('due now');
    expect(formatRelativeDue(NOW, NOW)).toBe('due now');
    expect(formatRelativeDue(Number.NaN, NOW)).toBe('due now');
  });

  it('formats sub-minute, minute and hour intervals', () => {
    expect(formatRelativeDue(NOW + 30_000, NOW)).toBe('in under a minute');
    expect(formatRelativeDue(NOW + MINUTE, NOW)).toBe('in 1 minute');
    expect(formatRelativeDue(NOW + 5 * MINUTE, NOW)).toBe('in 5 minutes');
    expect(formatRelativeDue(NOW + HOUR, NOW)).toBe('in 1 hour');
    expect(formatRelativeDue(NOW + 5 * HOUR, NOW)).toBe('in 5 hours');
  });

  it('formats day, month and year intervals', () => {
    expect(formatRelativeDue(NOW + DAY, NOW)).toBe('in 1 day');
    expect(formatRelativeDue(NOW + 4 * DAY, NOW)).toBe('in 4 days');
    expect(formatRelativeDue(NOW + 60 * DAY, NOW)).toBe('in 2 months');
    expect(formatRelativeDue(NOW + 400 * DAY, NOW)).toBe('in 1 year');
  });
});
