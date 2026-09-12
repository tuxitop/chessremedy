import { describe, expect, it } from 'vitest';
import {
  parseTimeControl,
  TIME_CONTROL_CATEGORIES,
  TIME_CONTROL_CATEGORY_VERSION,
  TIME_CONTROL_NORMALIZATION_VERSION,
  normalizeTimeControl,
  timeControlProfileForSource,
} from './timeControl';

describe('normalizeTimeControl (profile category tables)', () => {
  const lichessCases: ReadonlyArray<readonly [raw: string, expected: string]> = [
    ['60', 'bullet'],
    ['60+0', 'bullet'],
    ['179', 'bullet'],
    ['180', 'blitz'],
    ['300', 'blitz'],
    ['300+0', 'blitz'],
    ['300+2', 'blitz'],
    ['479', 'blitz'],
    ['480', 'rapid'],
    ['300+5', 'rapid'], // 300 + 200 = 500 s
    ['600+5', 'rapid'],
    ['900+10', 'rapid'],
    ['1499', 'rapid'],
    ['1500', 'classical'],
    ['1800', 'classical'],
    ['1800+10', 'classical'],
    ['10+0.1', 'bullet'], // fractional sub-minute control
    ['1/86400', 'correspondence'],
    ['1/259200', 'correspondence'],
    ['14 days per move', 'correspondence'], // Lichess correspondence dialect
    ['1 day per move', 'correspondence'],
    ['', 'unknown'],
    ['-', 'unknown'],
    ['?', 'unknown'],
    ['garbage', 'unknown'],
    ['abc+def', 'unknown'],
    ['2/86400', 'unknown'], // non-1 moves/seconds is unsupported
  ];

  for (const [raw, expected] of lichessCases) {
    it(`maps lichess ${JSON.stringify(raw)} to ${expected}`, () => {
      expect(normalizeTimeControl(raw, 'lichess').category).toBe(expected);
    });
  }

  it('gives the generic profile the identical boundaries to lichess', () => {
    for (const [raw, expected] of lichessCases) {
      expect(normalizeTimeControl(raw, 'generic').category).toBe(expected);
    }
  });

  const chesscomCases: ReadonlyArray<readonly [raw: string, expected: string]> = [
    ['60', 'bullet'],
    ['179', 'bullet'],
    ['180', 'blitz'],
    ['300', 'blitz'],
    ['300+2', 'blitz'],
    ['599', 'blitz'],
    ['600', 'rapid'],
    ['300+5', 'blitz'], // 500 s is blitz on Chess.com, rapid on Lichess
    ['600+5', 'rapid'],
    ['1499', 'rapid'],
    ['1500', 'rapid'],
    ['1800', 'rapid'], // Chess.com has no classical group
    ['1800+10', 'rapid'],
    ['10+0.1', 'bullet'],
    ['1/86400', 'correspondence'],
    ['1/259200', 'correspondence'],
    ['14 days per move', 'correspondence'],
    ['', 'unknown'],
    ['-', 'unknown'],
    ['garbage', 'unknown'],
  ];

  for (const [raw, expected] of chesscomCases) {
    it(`maps chesscom ${JSON.stringify(raw)} to ${expected}`, () => {
      expect(normalizeTimeControl(raw, 'chesscom').category).toBe(expected);
    });
  }

  it('classifies the same clock differently per profile (5|5 = 500 s)', () => {
    expect(normalizeTimeControl('300+5', 'lichess').category).toBe('rapid');
    expect(normalizeTimeControl('300+5', 'chesscom').category).toBe('blitz');
    expect(normalizeTimeControl('300+5', 'generic').category).toBe('rapid');
  });

  it('never produces a classical category for the chesscom profile', () => {
    for (const raw of ['1500', '1800', '3600', '1800+10']) {
      expect(normalizeTimeControl(raw, 'chesscom').category).not.toBe('classical');
    }
  });

  it('is deterministic and versioned', () => {
    for (const raw of ['60', '300+2', '600+5', '1/259200', 'nonsense']) {
      const first = normalizeTimeControl(raw, 'lichess');
      const second = normalizeTimeControl(raw, 'lichess');
      expect(first).toEqual(second);
      expect(first.version).toBe(TIME_CONTROL_NORMALIZATION_VERSION);
      expect(first.profile).toBe('lichess');
    }
  });

  it('fixes the canonical category set', () => {
    expect(TIME_CONTROL_CATEGORIES).toEqual([
      'bullet',
      'blitz',
      'rapid',
      'classical',
      'correspondence',
      'unknown',
    ]);
  });
});

describe('timeControlProfileForSource', () => {
  it('maps each source to its classification profile', () => {
    expect(timeControlProfileForSource('chesscom')).toBe('chesscom');
    expect(timeControlProfileForSource('lichess')).toBe('lichess');
    expect(timeControlProfileForSource('local')).toBe('generic');
    expect(timeControlProfileForSource('fixture')).toBe('generic');
  });
});

describe('parseTimeControl (structured model)', () => {
  it('separates base/increment/estimate from the category', () => {
    const tc = parseTimeControl('300+5', 'lichess');
    expect(tc.kind).toBe('clock');
    expect(tc.baseSeconds).toBe(300);
    expect(tc.incrementSeconds).toBe(5);
    expect(tc.estimatedSeconds).toBe(500);
    expect(tc.profile).toBe('lichess');
    expect(tc.category).toBe('rapid');
    expect(tc.categoryVersion).toBe(2);
    expect(tc.raw).toBe('300+5');
  });

  it('records the requested profile on the structured value', () => {
    expect(parseTimeControl('300+5', 'chesscom').profile).toBe('chesscom');
    expect(parseTimeControl('300+5', 'generic').profile).toBe('generic');
    expect(TIME_CONTROL_CATEGORY_VERSION).toBe(2);
  });

  it('keeps the raw string verbatim and parses every dialect', () => {
    expect(parseTimeControl('  600 ', 'generic').raw).toBe('  600 ');
    const daily = parseTimeControl('1/259200', 'generic');
    expect(daily.kind).toBe('correspondence');
    expect(daily.daysPerTurn).toBeCloseTo(3, 5);
    const lichessDaily = parseTimeControl('14 days per move', 'lichess');
    expect(lichessDaily.kind).toBe('correspondence');
    expect(lichessDaily.daysPerTurn).toBe(14);
    const fractional = parseTimeControl('10+0.1', 'chesscom');
    expect(fractional.kind).toBe('clock');
    expect(fractional.incrementSeconds).toBe(0.1);
    expect(fractional.category).toBe('bullet');
  });

  it('does not read unknown shapes as clocks', () => {
    expect(parseTimeControl('-', 'generic').kind).toBe('unknown');
    expect(parseTimeControl('?', 'generic').kind).toBe('unknown');
    expect(parseTimeControl('nonsense', 'generic').category).toBe('unknown');
  });

  it('keeps Lichess ultraBullet folded into bullet with the estimate kept', () => {
    const tc = parseTimeControl('15+0', 'lichess');
    expect(tc.category).toBe('bullet');
    expect(tc.estimatedSeconds).toBe(15);
  });
});

describe('TimeControl.display (M|I house style)', () => {
  const cases: ReadonlyArray<readonly [raw: string, display: string]> = [
    ['300+5', '5|5'],
    ['300', '5|0'],
    ['300+0', '5|0'],
    ['180+2', '3|2'],
    ['600+5', '10|5'],
    ['60+0', '1|0'],
    ['600', '10|0'],
    ['900+10', '15|10'],
    ['45+0', '45|0'],
    ['10+0.1', '10|0.1'],
    ['1/259200', '3 days/move'],
    ['1/86400', '1 day/move'],
    ['14 days per move', '14 days/move'],
    ['-', 'Unknown'],
    ['', 'Unknown'],
  ];

  for (const [raw, display] of cases) {
    it(`renders ${JSON.stringify(raw)} as ${JSON.stringify(display)}`, () => {
      expect(parseTimeControl(raw, 'generic').display).toBe(display);
    });
  }

  it('never renders a parsed seconds base as if it were minutes', () => {
    // A 5|5 game is never shown with a seconds/minutes mix (regression guard).
    const tc = parseTimeControl('300+5', 'generic');
    expect(tc.display).not.toMatch(/500/);
    expect(tc.display).not.toBe('500+5');
    expect(tc.display).toBe('5|5');
  });
});
