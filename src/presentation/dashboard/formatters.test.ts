import { describe, expect, it } from 'vitest';
import {
  EMPTY_VALUE_TEXT,
  formatAccuracyDisplay,
  formatCount,
  formatDashboardDate,
  formatDashboardTime,
  formatPercentValue,
  formatRating,
  formatSample,
} from './formatters';

describe('formatters', () => {
  it('formats counts and ratings as deterministic integers', () => {
    expect(formatCount(1500)).toBe('1500');
    expect(formatCount(2.6)).toBe('3');
    expect(formatRating(1516.4)).toBe('1516');
  });

  it('formats accuracy with the canonical Feature-009 helper and a percent sign', () => {
    expect(formatAccuracyDisplay(88.25)).toBe('88.3%');
    expect(formatAccuracyDisplay(90, 0)).toBe('90%');
    expect(formatAccuracyDisplay(null)).toBe(EMPTY_VALUE_TEXT);
  });

  it('formats percent values from a fraction', () => {
    expect(formatPercentValue(0.6667)).toBe('67%');
    expect(formatPercentValue(0.6667, 1)).toBe('66.7%');
  });

  it('formats solving time as mm:ss and h:mm:ss', () => {
    expect(formatDashboardTime(65_000)).toBe('01:05');
    expect(formatDashboardTime(0)).toBe('00:00');
    expect(formatDashboardTime(3_665_000)).toBe('1:01:05');
    expect(formatDashboardTime(null)).toBe(EMPTY_VALUE_TEXT);
  });

  it('formats a local date deterministically', () => {
    const ms = new Date(2026, 8, 1, 12, 0, 0).getTime();
    expect(formatDashboardDate(ms)).toBe('2026-09-01');
    expect(formatDashboardDate(null)).toBe(EMPTY_VALUE_TEXT);
  });

  it('formats a sample label, singularising n = 1', () => {
    expect(formatSample(6, 'games')).toBe('n = 6 games');
    expect(formatSample(1, 'games')).toBe('n = 1 game');
    expect(formatSample(0, 'puzzles')).toBe('n = 0 puzzles');
  });
});
