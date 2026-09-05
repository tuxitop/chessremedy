import { describe, expect, it } from 'vitest';
import { makeMove } from './test-support';
import { moveAccuracy, gameAccuracy, MOVE_ACCURACY_VERSION } from './accuracy';
import {
  blunderGameRecords,
  ordinaryGameRecords,
  fastProfileRecords,
} from './fixtures/classificationScenarios';

const GAME = 'lichess:acc';
const ANALYSIS = 'a-acc';

describe('MOVE_ACCURACY_VERSION (ADR-024)', () => {
  it('starts at version 1 and is prepared for future aggregate storage', () => {
    expect(MOVE_ACCURACY_VERSION).toBe(1);
  });
});

describe('moveAccuracy (ADR-024)', () => {
  it('scores an equal/perfect move as ~100', () => {
    expect(moveAccuracy({ cp: 0, mate: null }, { cp: 0, mate: null })).toBeCloseTo(100, 2);
    expect(moveAccuracy({ cp: 10, mate: null }, { cp: 10, mate: null })).toBeCloseTo(100, 2);
  });

  it('matches the ADR-024 Lichess formula on known eval pairs', () => {
    // ADR-024: accuracy = clamp(0,100, 103.1668·exp(−0.04354·wpLoss) − 3.1669)
    // with wpLoss = clamp(0,100, winPercent(before) − winPercent(after)) and
    // winPercent(cp) = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1).
    //
    // (10 → 0): wpLoss ≈ 0.92 ⇒ accuracy ≈ 95.947 (ordinary `good`).
    expect(moveAccuracy({ cp: 10, mate: null }, { cp: 0, mate: null })).toBeCloseTo(95.947, 3);
    // (20 → −10): wpLoss ≈ 2.76 ⇒ accuracy ≈ 88.316 (an inaccuracy).
    expect(moveAccuracy({ cp: 20, mate: null }, { cp: -10, mate: null })).toBeCloseTo(88.316, 3);
    // (0 → −1000): wpLoss ≈ 47.5 ⇒ accuracy ≈ 9.850 (a blunder).
    expect(moveAccuracy({ cp: 0, mate: null }, { cp: -1000, mate: null })).toBeCloseTo(9.85, 3);
  });

  it('treats a forced mate as ±10000 cp for the conversion', () => {
    // 0 vs mate-against-mover (−10000 → ~0% win) ⇒ accuracy ≈ 8.530. If mate
    // were ignored this would be ~100, so the assertion proves the handling.
    expect(moveAccuracy({ cp: 0, mate: null }, { cp: null, mate: -1 })).toBeCloseTo(8.53, 3);
    // A mating move for the mover (mate-in-1 before and after) stays ~100.
    expect(moveAccuracy({ cp: null, mate: 1 }, { cp: null, mate: 1 })).toBeCloseTo(100, 2);
  });

  it('clamps to [0, 100] on decisive losses', () => {
    // A ~95% win loss maps to a negative raw accuracy → clamped to 0.
    expect(moveAccuracy({ cp: 1000, mate: null }, { cp: -1000, mate: null })).toBe(0);
  });

  it('returns null when an evaluation input is missing or empty', () => {
    expect(moveAccuracy(null, { cp: 0, mate: null })).toBeNull();
    expect(moveAccuracy({ cp: 0, mate: null }, undefined)).toBeNull();
    expect(moveAccuracy({ cp: null, mate: null }, { cp: 0, mate: null })).toBeNull();
  });
});

describe('gameAccuracy (ADR-024)', () => {
  it('averages only the user moves with a usable eval pair (fixture)', () => {
    const records = ordinaryGameRecords(GAME, ANALYSIS);
    const result = gameAccuracy(records, 'white');
    // Six White plies, five ordinary ~95.95 and one inaccuracy ~88.32.
    expect(result.moves).toBe(6);
    expect(result.accuracy).toBeCloseTo(94.675, 2);
  });

  it('ignores the opponent moves entirely', () => {
    const records = ordinaryGameRecords(GAME, ANALYSIS);
    const black = gameAccuracy(records, 'black');
    // Six Black plies: five ordinary ~95.95 and one mistake ~53.83.
    expect(black.moves).toBe(6);
    expect(black.accuracy).toBeCloseTo(88.927, 2);
  });

  it('is deterministic over the same fixture', () => {
    const a = ordinaryGameRecords(GAME, ANALYSIS);
    const b = ordinaryGameRecords(GAME, ANALYSIS);
    expect(gameAccuracy(a, 'white')).toEqual(gameAccuracy(b, 'white'));
  });

  it('returns null accuracy with a 0 sample when there are no usable user moves', () => {
    expect(gameAccuracy([], 'white')).toEqual({ accuracy: null, moves: 0 });
    // All opponent moves.
    const opponentOnly = ordinaryGameRecords(GAME, ANALYSIS).filter((r) => r.side === 'black');
    expect(gameAccuracy(opponentOnly, 'white')).toEqual({ accuracy: null, moves: 0 });
  });

  it('excludes book moves by default (ADR-024) and includes them when asked', () => {
    const bookRecords = [
      makeMove(0, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        classification: 'good',
        inBook: true,
        evalBefore: { cp: 0, mate: null },
        evalAfter: { cp: -1000, mate: null },
      }),
      makeMove(2, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        classification: 'good',
        evalBefore: { cp: 0, mate: null },
        evalAfter: { cp: 0, mate: null },
      }),
    ];
    expect(gameAccuracy(bookRecords, 'white').moves).toBe(1);
    expect(gameAccuracy(bookRecords, 'white').accuracy).toBeCloseTo(100, 2);
    expect(gameAccuracy(bookRecords, 'white', { excludeBook: false }).moves).toBe(2);
  });

  it('works on the fast profile (wdl null) because accuracy uses only cp evals', () => {
    const records = fastProfileRecords(GAME, ANALYSIS);
    const white = gameAccuracy(records, 'white');
    const whiteMoves = records.filter((r) => r.side === 'white');
    expect(white.moves).toBe(whiteMoves.length);
    // (0 → −30) ≈ 88.323 and (0 → −120) ≈ 61.102 ⇒ mean ≈ 74.712.
    expect(white.accuracy).toBeCloseTo(74.712, 3);
  });

  it('reports accuracy on the blunder review fixture (opponent has the best move)', () => {
    const records = blunderGameRecords(GAME, ANALYSIS);
    // White played 1.f3 (good, ≈95.947) and 2.g4 (blunder: allows mate,
    // ≈8.530) ⇒ mean ≈ 52.239.
    const white = gameAccuracy(records, 'white');
    expect(white.moves).toBe(2);
    expect(white.accuracy).toBeCloseTo(52.239, 3);
    expect(white.accuracy).toBeLessThan(60);
  });
});
