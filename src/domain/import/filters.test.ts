import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_FILTERS,
  filtersEqual,
  isValidIsoDate,
  playedAtInWindow,
  resolveTimeFrame,
  timeControlsMatch,
  validateImportFilters,
} from './filters';
import type { ImportFilters, TimeFrame, TimeControlSelection } from './filters';
import { MS_PER_DAY } from './filters';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // 2026-07-15T12:00:00Z

describe('isValidIsoDate / isoDateToMs', () => {
  it('accepts real calendar dates and rejects impossible ones', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true); // leap year
    expect(isValidIsoDate('2026-02-29')).toBe(false); // not a leap year
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate('2026/04/01')).toBe(false);
    expect(isValidIsoDate('not-a-date')).toBe(false);
  });
});

describe('resolveTimeFrame', () => {
  it('resolves "all" to an unbounded window', () => {
    expect(resolveTimeFrame({ preset: 'all' }, NOW)).toEqual({ fromMs: null, toMs: null });
  });

  it('resolves presets backwards from now (toMs = now, inclusive)', () => {
    expect(resolveTimeFrame({ preset: 'last30d' }, NOW)).toEqual({
      fromMs: NOW - 30 * MS_PER_DAY,
      toMs: NOW,
    });
    expect(resolveTimeFrame({ preset: 'last3m' }, NOW)).toEqual({
      fromMs: NOW - 90 * MS_PER_DAY,
      toMs: NOW,
    });
    expect(resolveTimeFrame({ preset: 'last12m' }, NOW)).toEqual({
      fromMs: NOW - 365 * MS_PER_DAY,
      toMs: NOW,
    });
  });

  it('resolves a custom range to full inclusive UTC days', () => {
    expect(
      resolveTimeFrame({ preset: 'custom', from: '2026-07-01', to: '2026-07-02' }, NOW),
    ).toEqual({
      fromMs: Date.UTC(2026, 6, 1),
      toMs: Date.UTC(2026, 6, 2) + MS_PER_DAY - 1,
    });
  });
});

describe('playedAtInWindow', () => {
  const window = { fromMs: Date.UTC(2026, 6, 1), toMs: Date.UTC(2026, 6, 2) + MS_PER_DAY - 1 };

  it('matches instants inside the inclusive window', () => {
    expect(playedAtInWindow('2026-07-01T00:00:00.000Z', window)).toBe(true);
    expect(playedAtInWindow('2026-07-02T23:59:59.999Z', window)).toBe(true);
  });

  it('rejects instants outside the window', () => {
    expect(playedAtInWindow('2026-06-30T23:59:59.999Z', window)).toBe(false);
    expect(playedAtInWindow('2026-07-03T00:00:00.000Z', window)).toBe(false);
  });

  it('rejects dateless or unparseable records when any bound is active', () => {
    expect(playedAtInWindow(null, window)).toBe(false);
    expect(playedAtInWindow('not-a-date', window)).toBe(false);
  });

  it('accepts anything when the window is unbounded', () => {
    expect(playedAtInWindow(null, { fromMs: null, toMs: null })).toBe(true);
    expect(playedAtInWindow('2026-07-01T00:00:00.000Z', { fromMs: null, toMs: null })).toBe(true);
  });
});

describe('timeControlsMatch', () => {
  const all: TimeControlSelection = { kind: 'all' };
  const blitzRapid: TimeControlSelection = { kind: 'categories', categories: ['blitz', 'rapid'] };

  it('matches everything under "all"', () => {
    expect(timeControlsMatch(all, 'bullet')).toBe(true);
    expect(timeControlsMatch(all, 'unknown')).toBe(true);
  });

  it('matches only the selected categories under a narrowed selection', () => {
    expect(timeControlsMatch(blitzRapid, 'blitz')).toBe(true);
    expect(timeControlsMatch(blitzRapid, 'rapid')).toBe(true);
    expect(timeControlsMatch(blitzRapid, 'bullet')).toBe(false);
    expect(timeControlsMatch(blitzRapid, 'unknown')).toBe(false);
    expect(timeControlsMatch(blitzRapid, 'correspondence')).toBe(false);
  });
});

describe('validation', () => {
  it('accepts the defaults', () => {
    expect(validateImportFilters(DEFAULT_IMPORT_FILTERS)).toBeNull();
  });

  it('rejects an empty or unknown category selection', () => {
    const base = { timeFrame: { preset: 'all' as const } };
    expect(
      validateImportFilters({ ...base, timeControls: { kind: 'categories', categories: [] } }),
    ).toBe('emptyCategories');
    expect(
      validateImportFilters({
        ...base,
        timeControls: { kind: 'categories', categories: ['bullet', 'unknown'] as never },
      }),
    ).toBe('unknownCategory');
  });

  it('rejects invalid or inverted custom dates', () => {
    const base: TimeControlSelection = { kind: 'all' };
    const frame = (timeFrame: TimeFrame): ImportFilters => ({ timeFrame, timeControls: base });
    expect(
      validateImportFilters(frame({ preset: 'custom', from: '2026/01/01', to: '2026-02-01' })),
    ).toBe('invalidDate');
    expect(
      validateImportFilters(frame({ preset: 'custom', from: '2026-02-01', to: '2026-01-01' })),
    ).toBe('fromAfterTo');
    expect(
      validateImportFilters(frame({ preset: 'custom', from: '2026-01-01', to: '2026-02-01' })),
    ).toBeNull();
  });
});

describe('filtersEqual', () => {
  it('is true for identical defaults', () => {
    expect(filtersEqual(DEFAULT_IMPORT_FILTERS, DEFAULT_IMPORT_FILTERS)).toBe(true);
  });

  it('compares category sets order-insensitively', () => {
    const a: ImportFilters = {
      ...DEFAULT_IMPORT_FILTERS,
      timeControls: { kind: 'categories', categories: ['blitz', 'rapid'] },
    };
    const b: ImportFilters = {
      ...DEFAULT_IMPORT_FILTERS,
      timeControls: { kind: 'categories', categories: ['rapid', 'blitz'] },
    };
    const c: ImportFilters = {
      ...DEFAULT_IMPORT_FILTERS,
      timeControls: { kind: 'categories', categories: ['rapid', 'bullet'] },
    };
    expect(filtersEqual(a, b)).toBe(true);
    expect(filtersEqual(a, c)).toBe(false);
  });

  it('compares custom ranges and presets', () => {
    const customA: TimeFrame = { preset: 'custom', from: '2026-01-01', to: '2026-02-01' };
    const customB: TimeFrame = { preset: 'custom', from: '2026-01-01', to: '2026-02-02' };
    const allA: ImportFilters = { timeFrame: { preset: 'all' }, timeControls: { kind: 'all' } };
    const allB: ImportFilters = { timeFrame: { preset: 'last30d' }, timeControls: { kind: 'all' } };
    expect(filtersEqual({ ...allA, timeFrame: customA }, { ...allA, timeFrame: customA })).toBe(
      true,
    );
    expect(filtersEqual({ ...allA, timeFrame: customA }, { ...allA, timeFrame: customB })).toBe(
      false,
    );
    expect(filtersEqual(allA, allB)).toBe(false);
  });
});
