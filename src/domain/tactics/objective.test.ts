/**
 * Tactical-objective classification tests (Feature 010). Each of the four
 * objectives is classified from hand-built plain-number inputs (research §3
 * step 3); precedence, the mate distance cap and mate sign are pinned here.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyObjective,
  DECISIVE_WP_SWING,
  FORCING_MATE_MAX_DISTANCE,
  isMaterialStartLost,
  NEUTRALIZING_FINE_END_CP,
  NEUTRALIZING_FINE_END_WDL_L,
  NEUTRALIZING_LOST_BEFORE_CP,
  NEUTRALIZING_LOST_BEFORE_WDL_L,
  WINNING_MATERIAL_MAX_LOST_START_CP,
  WINNING_MATERIAL_MIN_DELTA,
} from './objective';
import type { ObjectiveInputs } from './objective';

function inputs(overrides: Partial<ObjectiveInputs> = {}): ObjectiveInputs {
  return {
    lineMaterialDelta: 0,
    startEvalCp: 0,
    endEvalCp: 0,
    endEvalMate: null,
    endWdl: { w: 500, d: 400, l: 100 },
    wdlBefore: { w: 500, d: 400, l: 100 },
    ...overrides,
  };
}

describe('objective thresholds & constants', () => {
  it('pins the research/calibration thresholds', () => {
    // Owner decision: a 2-point net material gain already qualifies as a
    // missed tactical win (a won exchange / quiet fork), not only >= 3.
    expect(WINNING_MATERIAL_MIN_DELTA).toBe(2);
    expect(WINNING_MATERIAL_MAX_LOST_START_CP).toBe(-350);
    expect(FORCING_MATE_MAX_DISTANCE).toBe(8);
    expect(DECISIVE_WP_SWING).toBe(30);
    expect(NEUTRALIZING_LOST_BEFORE_WDL_L).toBe(800);
    expect(NEUTRALIZING_LOST_BEFORE_CP).toBe(-800);
    expect(NEUTRALIZING_FINE_END_WDL_L).toBe(300);
    expect(NEUTRALIZING_FINE_END_CP).toBe(-200);
  });
});

describe('classifyObjective — winning material', () => {
  it('classifies a net material gain of at least 2 piece-value units', () => {
    expect(classifyObjective(inputs({ lineMaterialDelta: 2 }))).toBe('winning_material');
    expect(classifyObjective(inputs({ lineMaterialDelta: 3 }))).toBe('winning_material');
    expect(classifyObjective(inputs({ lineMaterialDelta: 9 }))).toBe('winning_material');
  });

  it('does not classify a sub-threshold material gain', () => {
    expect(classifyObjective(inputs({ lineMaterialDelta: 1.9 }))).toBeNull();
  });

  it('suppresses winning material when the mover starts already lost (plan 015)', () => {
    // Owner's 28.Rd1 shape (detectionVersion 10): the mover nets +2 inside the
    // window (grabbing two loose pawns in an even trade) but is dead lost before
    // (-648cp, ~8% win) AND after; no other objective may fire (the line does
    // not mate, does not remove a forced loss and barely moves the win %).
    const lost = inputs({
      lineMaterialDelta: 2,
      startEvalCp: -648,
      endEvalCp: -825,
      endWdl: { w: 0, d: 0, l: 1000 },
      endEvalMate: null,
      wdlBefore: null,
    });
    expect(classifyObjective(lost)).toBeNull();
  });

  it('still surfaces winning material from a lost-but-not-decisive start', () => {
    // Plan-14 genuine forks surface from ~-200cp positions (owner decision):
    // only a start below the floor suppresses the objective.
    expect(classifyObjective(inputs({ lineMaterialDelta: 2, startEvalCp: -218 }))).toBe(
      'winning_material',
    );
  });

  it('floors strictly below -350 (the boundary value still qualifies)', () => {
    expect(isMaterialStartLost(-351)).toBe(true);
    expect(isMaterialStartLost(-350)).toBe(false);
    expect(isMaterialStartLost(-218)).toBe(false);
    expect(isMaterialStartLost(null)).toBe(false);
    expect(classifyObjective(inputs({ lineMaterialDelta: 2, startEvalCp: -350 }))).toBe(
      'winning_material',
    );
  });
});

describe('classifyObjective — forcing mate', () => {
  it('classifies a mover mate at distance 8 or less', () => {
    expect(classifyObjective(inputs({ endEvalMate: 1 }))).toBe('forcing_mate');
    expect(classifyObjective(inputs({ endEvalMate: 8 }))).toBe('forcing_mate');
  });

  it('rejects a mate beyond distance 8', () => {
    const nearMiss = inputs({ endEvalMate: 9, endEvalCp: null, endWdl: null });
    expect(classifyObjective(nearMiss)).toBeNull();
    expect(classifyObjective(nearMiss)).not.toBe('forcing_mate');
  });

  it('only counts the mover as mating (positive mate for the mover)', () => {
    // Negative mate: the mover is being mated — never a forcing_mate objective.
    expect(
      classifyObjective(inputs({ endEvalMate: -3, endEvalCp: null, endWdl: null })),
    ).toBeNull();
    expect(
      classifyObjective(inputs({ endEvalMate: -8, endEvalCp: null, endWdl: null })),
    ).toBeNull();
  });
});

describe('classifyObjective — neutralizing threat', () => {
  it('classifies a forced loss before that the line removes (WDL path)', () => {
    const result = classifyObjective(
      inputs({
        wdlBefore: { w: 50, d: 100, l: 850 },
        endWdl: { w: 550, d: 250, l: 200 },
        startEvalCp: -600,
        endEvalCp: 0,
      }),
    );
    // The ~40-point win-percentage swing alone would read as a decisive
    // advantage; the forced-loss before-state makes it a neutralizing threat.
    expect(result).toBe('neutralizing_threat');
  });

  it('classifies the threat removal from centipawn evals when WDL is absent', () => {
    const result = classifyObjective(
      inputs({
        wdlBefore: null,
        endWdl: null,
        startEvalCp: -900,
        endEvalCp: 0,
      }),
    );
    expect(result).toBe('neutralizing_threat');
  });

  it('does not classify when the line still ends lost for the mover', () => {
    const result = classifyObjective(
      inputs({
        wdlBefore: { w: 50, d: 50, l: 900 },
        endWdl: { w: 100, d: 100, l: 800 },
        startEvalCp: -1000,
        endEvalCp: -800,
      }),
    );
    expect(result).toBeNull();
  });

  it('does not classify a benign position that merely improves', () => {
    expect(classifyObjective(inputs({ wdlBefore: { w: 500, d: 400, l: 100 } }))).toBeNull();
  });
});

describe('classifyObjective — decisive advantage & precedence', () => {
  it('classifies a win-percentage swing of at least 30 with no other objective', () => {
    // start 0 → ~50% ; end 400cp → ~81%, a ~31-point mover swing.
    expect(classifyObjective(inputs({ startEvalCp: 0, endEvalCp: 400 }))).toBe(
      'decisive_advantage',
    );
  });

  it('does not classify a swing below 30', () => {
    // end 300cp → ~75%, a ~25-point swing.
    expect(classifyObjective(inputs({ startEvalCp: 0, endEvalCp: 300 }))).toBeNull();
  });

  it('gives winning material precedence over a decisive swing', () => {
    const result = classifyObjective(
      inputs({ lineMaterialDelta: 3, startEvalCp: 0, endEvalCp: 400 }),
    );
    expect(result).toBe('winning_material');
  });

  it('gives forcing mate precedence over a decisive swing', () => {
    const result = classifyObjective(inputs({ endEvalMate: 3, startEvalCp: 0, endEvalCp: 400 }));
    expect(result).toBe('forcing_mate');
  });

  it('gives winning material precedence over a neutralizing-threat shape', () => {
    const result = classifyObjective(
      inputs({
        lineMaterialDelta: 3,
        wdlBefore: { w: 50, d: 100, l: 850 },
        endWdl: { w: 550, d: 250, l: 200 },
      }),
    );
    expect(result).toBe('winning_material');
  });
});

describe('classifyObjective — no objective', () => {
  it('returns null when no objective is reached', () => {
    expect(classifyObjective(inputs())).toBeNull();
    expect(classifyObjective(inputs({ lineMaterialDelta: 0.5 }))).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    const a = inputs({ lineMaterialDelta: 1, startEvalCp: -50, endEvalCp: 60 });
    expect(classifyObjective(a)).toBe(classifyObjective({ ...a }));
  });
});
