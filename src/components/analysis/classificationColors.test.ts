import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOVE_CLASSIFICATIONS } from '@/domain/chess';
import {
  CLASSIFICATION_COLORS,
  MISSED_TACTIC_COLOR,
  ZERO_COUNT_COLOR,
  NEUTRAL_COUNT_COLOR,
  classificationCountColor,
  missedTacticCountColor,
} from './classificationColors';

/** Approximate perceptual distance between two hex colours (RGB euclid). */
function hexDistance(a: string, b: string): number {
  const rgb = (hex: string): readonly [number, number, number] => {
    const value = hex.replace('#', '');
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

describe('classificationColors (P5 canonical palette)', () => {
  it('covers every classification state exactly once', () => {
    expect(Object.keys(CLASSIFICATION_COLORS).sort()).toEqual([...MOVE_CLASSIFICATIONS].sort());
  });

  it('keeps inaccuracy and mistake visually distinct (amber vs orange)', () => {
    // P5 distinctness rule: the two must differ by more than a small RGB
    // threshold so they never read as the same colour.
    const distance = hexDistance(CLASSIFICATION_COLORS.inaccuracy, CLASSIFICATION_COLORS.mistake);
    expect(CLASSIFICATION_COLORS.inaccuracy).toBe('#d89000');
    expect(CLASSIFICATION_COLORS.mistake).toBe('#d94f00');
    expect(distance).toBeGreaterThan(10);
  });

  it('colours counts by classification with the zero rule', () => {
    expect(classificationCountColor('blunder', 2)).toBe('#c4261c');
    expect(classificationCountColor('mistake', 1)).toBe('#d94f00');
    expect(classificationCountColor('inaccuracy', 1)).toBe('#d89000');
    // Negative classes read green when zero (nothing went wrong).
    expect(classificationCountColor('blunder', 0)).toBe(ZERO_COUNT_COLOR);
    expect(classificationCountColor('mistake', 0)).toBe(ZERO_COUNT_COLOR);
    expect(classificationCountColor('inaccuracy', 0)).toBe(ZERO_COUNT_COLOR);
    // best/good are never emphasised when zero.
    expect(classificationCountColor('best', 0)).toBe(NEUTRAL_COUNT_COLOR);
    expect(classificationCountColor('good', 0)).toBe(NEUTRAL_COUNT_COLOR);
    expect(classificationCountColor('best', 3)).toBe(CLASSIFICATION_COLORS.best);
    expect(classificationCountColor('good', 4)).toBe(CLASSIFICATION_COLORS.good);
  });

  it('colours the missed-tactic count green at zero, magenta when present', () => {
    expect(missedTacticCountColor(0)).toBe(ZERO_COUNT_COLOR);
    expect(missedTacticCountColor(1)).toBe(MISSED_TACTIC_COLOR);
  });

  it('keeps the board square highlights in parity with the canonical palette', () => {
    // P5 single source of truth: `reviewBoardHighlights.css` expresses each
    // classification as `rgba(<hex>, <alpha>)`. This guard fails if a hex in
    // the CSS drifts from the palette module.
    const css = readFileSync(resolve(process.cwd(), 'src/pages/reviewBoardHighlights.css'), 'utf8');
    const rgbaFromHex = (hex: string, alpha: string): string =>
      `rgba(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;

    const cases: ReadonlyArray<[string, string, string]> = [
      ['review-cls-best', CLASSIFICATION_COLORS.best, '0.42'],
      ['review-cls-inaccuracy', CLASSIFICATION_COLORS.inaccuracy, '0.42'],
      ['review-cls-mistake', CLASSIFICATION_COLORS.mistake, '0.48'],
      ['review-cls-blunder', CLASSIFICATION_COLORS.blunder, '0.5'],
    ];
    for (const [className, hex, alpha] of cases) {
      const rule = new RegExp(`\\.${className}\\s*\\{[^}]*background-color:\\s*([^;]+);`);
      const match = rule.exec(css);
      expect(match, `missing ${className} rule`).not.toBeNull();
      expect(match![1]!.trim(), `${className} parity`).toBe(rgbaFromHex(hex, alpha));
    }
  });
});
