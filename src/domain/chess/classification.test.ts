import { describe, expect, it } from 'vitest';
import type { EvalCpMate, MoveClassification, PlayedMove } from './analysis';
import {
  classifyMove,
  CLASSIFICATION_VERSION,
  cpValueOf,
  winPercentFromCp,
  WPLOSS_BLUNDER,
  WPLOSS_INACCURACY,
  WPLOSS_MISTAKE,
} from './classification';

const BEST: PlayedMove = { san: 'Nxd5', uci: 'c3d5' };
const OTHER: PlayedMove = { san: 'Bxe6', uci: 'b3e6' };

function inputs(overrides: Partial<Parameters<typeof classifyMove>[0]> = {}) {
  return {
    evalBefore: { cp: 30, mate: null },
    evalAfter: { cp: -120, mate: null },
    bestMove: BEST,
    playedMove: OTHER,
    legalMovesCount: 28,
    wdlBefore: { w: 528, d: 460, l: 12 },
    wdlAfter: { w: 380, d: 560, l: 60 },
    gamePhase: 'middlegame' as const,
    inBook: false,
    topCpValues: [30],
    ...overrides,
  };
}

function cp(mate: number | null, cp: number | null): EvalCpMate {
  return { cp, mate };
}

describe('classification thresholds & constants', () => {
  it('pins the canonical versions and Lichess win-percentage thresholds', () => {
    expect(CLASSIFICATION_VERSION).toBe(2);
    // Lichess winningChanceJudgements 0.10 / 0.20 / 0.30 → win% 5 / 10 / 15.
    expect([WPLOSS_INACCURACY, WPLOSS_MISTAKE, WPLOSS_BLUNDER]).toEqual([5, 10, 15]);
  });

  it('clamps win percent to [0, 100] and to ±1000 cp (Lichess CEILING)', () => {
    expect(winPercentFromCp(0)).toBeCloseTo(50, 1);
    // cp is capped at ±1000 before the logistic: 10000 behaves like 1000.
    expect(winPercentFromCp(10000)).toBeCloseTo(winPercentFromCp(1000), 6);
    expect(winPercentFromCp(10000)).toBeGreaterThan(90);
    expect(winPercentFromCp(-10000)).toBeCloseTo(winPercentFromCp(-1000), 6);
    expect(winPercentFromCp(-10000)).toBeLessThan(10);
    // cpValueOf still exposes the raw mate magnitude used for cp math.
    expect(cpValueOf(cp(3, null))).toBe(10000);
    expect(cpValueOf(cp(-2, null))).toBe(-10000);
    expect(cpValueOf(cp(null, 40))).toBe(40);
  });
});

describe('classifyMove (WDL path)', () => {
  it('returns best when the played move is the engine choice and no tie', () => {
    expect(classifyMove(inputs({ playedMove: BEST }))).toBe('best');
  });

  it('downgrades best to good on a best-move tie (within 5 cp)', () => {
    const base = inputs({ playedMove: BEST });
    expect(classifyMove({ ...base, topCpValues: [30, 27] })).toBe('good');
  });

  it('classifies a 13.6-point win-percentage loss as mistake (10 ≤ loss < 15)', () => {
    // evalBefore +30 → 52.8% ; evalAfter -120 → 39.1% ⇒ wpLoss ≈ 13.6.
    expect(classifyMove(inputs())).toBe('mistake');
  });

  it('keeps a small loss as good', () => {
    const base = inputs({ evalAfter: { cp: 20, mate: null } });
    expect(classifyMove(base)).toBe('good');
  });

  it('bands a ~6.5-point loss as inaccuracy (5 ≤ loss < 10)', () => {
    const base = inputs({ evalAfter: { cp: -40, mate: null } });
    expect(classifyMove(base)).toBe('inaccuracy');
  });

  it('classifies a decisive loss as blunder (≥ 15)', () => {
    const base = inputs({ evalAfter: { cp: -1000, mate: null } });
    expect(classifyMove(base)).toBe('blunder');
  });

  it('bands a big win-percentage swing as blunder and a 13.6-point one as mistake', () => {
    // winPercent(200) ≈ 67.6 ; winPercent(-200) ≈ 32.4 ⇒ loss ≈ 35 → blunder.
    const blunder = inputs({
      evalBefore: { cp: 200, mate: null },
      evalAfter: { cp: -200, mate: null },
    });
    expect(classifyMove(blunder)).toBe('blunder');
    // The ADR worked-example 13.6-point loss is a mistake (10 ≤ loss < 15).
    expect(classifyMove(inputs())).toBe('mistake');
  });

  it('caps a forced move at mistake', () => {
    const base = inputs({ legalMovesCount: 1, evalAfter: { cp: -1000, mate: null } });
    expect(classifyMove(base)).toBe('mistake');
  });

  it('flags a mate sign flip as blunder regardless of wpLoss', () => {
    const base = inputs({
      evalBefore: cp(null, 0),
      evalAfter: cp(-2, null),
      wdlBefore: { w: 500, d: 480, l: 20 },
      wdlAfter: { w: 0, d: 0, l: 1000 },
    });
    expect(classifyMove(base)).toBe('blunder');
  });
});

describe('classifyMove (fast centipawn fallback)', () => {
  it('falls back to phase-dependent cp thresholds when WDL is null', () => {
    const base = {
      ...inputs(),
      wdlBefore: null,
      wdlAfter: null,
      evalBefore: cp(null, 0),
      evalAfter: cp(null, -100),
    };
    // Middlegame thresholds: inaccuracy 80 ≤ 100 < mistake 150.
    expect(classifyMove({ ...base, gamePhase: 'middlegame' })).toBe('inaccuracy');
    // Opening thresholds: 100 is a mistake (≥ 100).
    expect(classifyMove({ ...base, gamePhase: 'opening' })).toBe('mistake');
    // Endgame thresholds: 100 is a mistake.
    expect(classifyMove({ ...base, gamePhase: 'endgame' })).toBe('mistake');
  });

  it('applies forced-move and best-move rules in the fallback too', () => {
    const blunderish = {
      ...inputs(),
      wdlBefore: null,
      wdlAfter: null,
      evalBefore: cp(null, 0),
      evalAfter: cp(null, -400),
      legalMovesCount: 1,
      gamePhase: 'middlegame' as const,
    };
    expect(classifyMove(blunderish)).toBe('mistake');
    expect(classifyMove({ ...blunderish, playedMove: BEST, legalMovesCount: 20 })).toBe('best');
  });
});

describe('classifyMove book & unclassifiable inputs', () => {
  it('tags book moves as good', () => {
    expect(classifyMove(inputs({ inBook: true }))).toBe('good');
  });

  it('returns good when inputs are missing', () => {
    const base = inputs();
    expect(classifyMove({ ...base, playedMove: null })).toBe('good');
    expect(classifyMove({ ...base, evalAfter: null })).toBe('good');
  });
});

describe('classification determinism', () => {
  it('is a pure function of its inputs', () => {
    const a = inputs();
    const b = inputs();
    const resultA: MoveClassification = classifyMove(a);
    const resultB: MoveClassification = classifyMove(b);
    expect(resultA).toBe(resultB);
  });
});
