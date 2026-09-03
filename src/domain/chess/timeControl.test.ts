import { describe, expect, it } from 'vitest';
import {
  TIME_CONTROL_CATEGORIES,
  TIME_CONTROL_NORMALIZATION_VERSION,
  normalizeTimeControl,
} from './timeControl';

describe('normalizeTimeControl', () => {
  const cases: ReadonlyArray<readonly [raw: string, expected: string]> = [
    ['60', 'bullet'],
    ['179', 'bullet'],
    ['180', 'blitz'],
    ['300', 'blitz'],
    ['300+0', 'blitz'],
    ['300+2', 'blitz'],
    ['479', 'blitz'],
    ['480', 'rapid'],
    ['600+5', 'rapid'],
    ['900+10', 'rapid'],
    ['1499', 'rapid'],
    ['1500', 'classical'],
    ['1800', 'classical'],
    ['1800+10', 'classical'],
    ['1/172800', 'correspondence'],
    ['1/259200', 'correspondence'],
    ['1/86400', 'correspondence'],
    ['', 'unknown'],
    ['-', 'unknown'],
    ['?', 'unknown'],
    ['garbage', 'unknown'],
    ['abc+def', 'unknown'],
  ];

  for (const [raw, expected] of cases) {
    it(`maps ${JSON.stringify(raw)} to ${expected}`, () => {
      expect(normalizeTimeControl(raw).category).toBe(expected);
    });
  }

  it('is deterministic and versioned', () => {
    for (const raw of ['60', '300+2', '600+5', '1/259200', 'nonsense']) {
      const first = normalizeTimeControl(raw);
      const second = normalizeTimeControl(raw);
      expect(first).toEqual(second);
      expect(first.version).toBe(TIME_CONTROL_NORMALIZATION_VERSION);
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
