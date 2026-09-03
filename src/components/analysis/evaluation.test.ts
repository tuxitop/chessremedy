import { describe, expect, it } from 'vitest';
import { bottomAdvantageFraction, evaluationCp } from './evaluation';

describe('evaluationCp', () => {
  it('converts a side-to-move evaluation to a fixed color perspective', () => {
    // White to move, +1.00 (White advantage): from White's perspective +100.
    expect(evaluationCp({ cp: 100 }, 'white', 'white')).toBe(100);
    expect(evaluationCp({ cp: 100 }, 'black', 'white')).toBe(-100);
    // Black to move: a +1.00 side-to-move score means Black is better, so from
    // White's perspective it is -100.
    expect(evaluationCp({ cp: 100 }, 'white', 'black')).toBe(-100);
    expect(evaluationCp({ cp: 100 }, 'black', 'black')).toBe(100);
  });

  it('handles mate evaluations as extreme values', () => {
    // White to move and mates in 2: White is winning.
    expect(evaluationCp({ mate: 2 }, 'white', 'white')).toBe(10_000);
    expect(evaluationCp({ mate: -2 }, 'white', 'white')).toBe(-10_000);
  });
});

describe('bottomAdvantageFraction', () => {
  it('centres the bar for an equal position', () => {
    expect(bottomAdvantageFraction({ cp: 0 }, 'white', 'white')).toBeCloseTo(0.5, 3);
  });

  it('grows toward 1 when the bottom player is better', () => {
    expect(bottomAdvantageFraction({ cp: 300 }, 'white', 'white')).toBeGreaterThan(0.6);
    expect(bottomAdvantageFraction({ cp: 5000 }, 'white', 'white')).toBeGreaterThan(0.99);
  });

  it('shrinks toward 0 when the bottom player is worse', () => {
    expect(bottomAdvantageFraction({ cp: -300 }, 'white', 'white')).toBeLessThan(0.4);
    expect(bottomAdvantageFraction({ cp: -5000 }, 'white', 'white')).toBeLessThan(0.01);
  });

  it('flips for black at the bottom', () => {
    // White to move, White better (+3.00): black at the bottom is worse.
    expect(bottomAdvantageFraction({ cp: 300 }, 'black', 'white')).toBeLessThan(0.4);
  });

  it('pins the bar for mates', () => {
    // Bottom White mates → 1; bottom White is mated → 0.
    expect(bottomAdvantageFraction({ mate: 1 }, 'white', 'white')).toBe(1);
    expect(bottomAdvantageFraction({ mate: -1 }, 'white', 'white')).toBe(0);
  });
});
