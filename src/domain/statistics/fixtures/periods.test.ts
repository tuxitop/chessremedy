import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assignToPeriod, enumeratePeriods, periodBoundsOf, periodKeyOf } from '../periods';

const DEFAULT_TZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'America/New_York';
});

afterEach(() => {
  process.env.TZ = DEFAULT_TZ ?? 'UTC';
});

function local(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month, day, hour).getTime();
}

describe('periodKeyOf — day and month', () => {
  it('keys a local calendar day', () => {
    expect(periodKeyOf(local(2026, 0, 1), 'day')).toBe('2026-01-01');
  });

  it('crosses the month and year boundary correctly', () => {
    expect(periodKeyOf(local(2025, 11, 31), 'month')).toBe('2025-12');
    expect(periodKeyOf(local(2026, 0, 1), 'month')).toBe('2026-01');
  });
});

describe('periodKeyOf — ISO-8601 week', () => {
  it('assigns a year-spanning week to the new ISO year', () => {
    expect(periodKeyOf(local(2025, 11, 29), 'week')).toBe('2026-W01');
    expect(periodKeyOf(local(2025, 11, 31), 'week')).toBe('2026-W01');
    expect(periodKeyOf(local(2026, 0, 1), 'week')).toBe('2026-W01');
    expect(periodKeyOf(local(2026, 0, 4), 'week')).toBe('2026-W01');
    expect(periodKeyOf(local(2026, 0, 5), 'week')).toBe('2026-W02');
  });

  it('produces week 53 when the ISO rule requires it', () => {
    expect(periodKeyOf(local(2020, 11, 28), 'week')).toBe('2020-W53');
    expect(periodKeyOf(local(2021, 0, 3), 'week')).toBe('2020-W53');
    expect(periodKeyOf(local(2021, 0, 4), 'week')).toBe('2021-W01');
    expect(periodKeyOf(local(2026, 11, 28), 'week')).toBe('2026-W53');
    expect(periodKeyOf(local(2027, 0, 3), 'week')).toBe('2026-W53');
    expect(periodKeyOf(local(2027, 0, 4), 'week')).toBe('2027-W01');
  });
});

describe('periodBoundsOf', () => {
  it('returns whole inclusive local bounds', () => {
    const day = periodBoundsOf(local(2026, 0, 1), 'day');
    expect(day).toEqual({
      key: '2026-01-01',
      startMs: new Date(2026, 0, 1).getTime(),
      endMs: new Date(2026, 0, 2).getTime() - 1,
    });
  });

  it('is DST-safe on the spring-forward 23-hour day', () => {
    const day = periodBoundsOf(local(2026, 2, 8), 'day');
    expect(day.key).toBe('2026-03-08');
    expect(day.endMs - day.startMs + 1).toBe(23 * 60 * 60 * 1000);
  });

  it('is DST-safe on the fall-back 25-hour day', () => {
    const day = periodBoundsOf(local(2026, 10, 1), 'day');
    expect(day.key).toBe('2026-11-01');
    expect(day.endMs - day.startMs + 1).toBe(25 * 60 * 60 * 1000);
  });
});

describe('enumeratePeriods', () => {
  it('emits every week in range ascending across a year boundary', () => {
    const periods = enumeratePeriods(local(2025, 11, 29), local(2026, 0, 12), 'week');
    expect(periods.map((period) => period.key)).toEqual(['2026-W01', '2026-W02', '2026-W03']);
  });

  it('emits every month in range ascending across a year boundary', () => {
    const periods = enumeratePeriods(local(2025, 10, 15), local(2026, 1, 10), 'month');
    expect(periods.map((period) => period.key)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('emits consecutive local days across a DST transition', () => {
    const periods = enumeratePeriods(local(2026, 2, 6), local(2026, 2, 10), 'day');
    expect(periods.map((period) => period.key)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    for (let index = 1; index < periods.length; index += 1) {
      expect(periods[index]!.startMs).toBeGreaterThan(periods[index - 1]!.startMs);
      expect(periods[index]!.startMs).toBe(periods[index - 1]!.endMs + 1);
    }
  });

  it('returns no periods for a reversed range', () => {
    expect(enumeratePeriods(local(2026, 0, 10), local(2026, 0, 1), 'day')).toEqual([]);
  });
});

describe('assignToPeriod', () => {
  it('assigns an instant to its local period key and null to no instant', () => {
    expect(assignToPeriod('2026-01-01T12:00:00.000Z', 'day')).toBe('2026-01-01');
    expect(assignToPeriod('2026-01-01T12:00:00.000Z', 'week')).toBe('2026-W01');
    expect(assignToPeriod(null, 'day')).toBeNull();
    expect(assignToPeriod('not-a-date', 'day')).toBeNull();
  });
});
