/**
 * ADR-025 difficulty-formula tests. Pins the weights/caps, re-derives the
 * anchor values by hand from the ADR formula, and checks the term caps, the
 * depth bonus threshold, the clamp and determinism.
 */

import { describe, expect, it } from 'vitest';
import {
  CANDIDATES_TERM_CAP,
  CANDIDATES_WEIGHT,
  DEPTH_BONUS,
  DEPTH_BONUS_MIN_DEPTH,
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  estimateDifficulty,
  EVAL_SWING_TERM_CAP,
  EVAL_SWING_WEIGHT,
  FORCINGNESS_WEIGHT,
  LENGTH_TERM_CAP,
  LENGTH_WEIGHT,
  MATERIAL_TERM_CAP,
  MATERIAL_WEIGHT,
} from './difficulty';
import type { DifficultyInputs } from './difficulty';

function inputs(overrides: Partial<DifficultyInputs> = {}): DifficultyInputs {
  return {
    lineLength: 0,
    candidateFirstMoves: 0,
    forcingness: 0,
    evalSwing: 0,
    material: 0,
    depth: 0,
    ...overrides,
  };
}

describe('ADR-025 weights and caps', () => {
  it('pins every weight and term cap to the ADR-025 constants', () => {
    expect(LENGTH_WEIGHT).toBe(10);
    expect(LENGTH_TERM_CAP).toBe(6);
    expect(CANDIDATES_WEIGHT).toBe(8);
    expect(CANDIDATES_TERM_CAP).toBe(6);
    expect(FORCINGNESS_WEIGHT).toBe(35);
    expect(EVAL_SWING_WEIGHT).toBe(12);
    expect(EVAL_SWING_TERM_CAP).toBe(400);
    expect(MATERIAL_WEIGHT).toBe(10);
    expect(MATERIAL_TERM_CAP).toBe(12);
    expect(DEPTH_BONUS).toBe(5);
    expect(DEPTH_BONUS_MIN_DEPTH).toBe(26);
    expect([DIFFICULTY_MIN, DIFFICULTY_MAX]).toEqual([0, 100]);
  });
});

describe('estimateDifficulty — ADR-025 anchors', () => {
  it('scores an empty/trivial line at the floor', () => {
    expect(estimateDifficulty(inputs())).toBe(0);
  });

  it('recomputes a worked example to the integer (depth 25 → no bonus)', () => {
    // 10*2 + 8*2 + 35*(100/100) + 12*min(400,400)/400 + 10*min(12,12)/12
    //   = 20 + 16 + 35 + 12 + 10 = 93.
    const base = inputs({
      lineLength: 2,
      candidateFirstMoves: 2,
      forcingness: 100,
      evalSwing: 400,
      material: 12,
    });
    expect(estimateDifficulty({ ...base, depth: 25 })).toBe(93);
    expect(estimateDifficulty({ ...base, depth: 22 })).toBe(93);
  });

  it('adds the depth bonus at depth 26 (98 = 93 + 5)', () => {
    const base = inputs({
      lineLength: 2,
      candidateFirstMoves: 2,
      forcingness: 100,
      evalSwing: 400,
      material: 12,
    });
    expect(estimateDifficulty({ ...base, depth: 26 })).toBe(98);
    expect(estimateDifficulty({ ...base, depth: 30 })).toBe(98);
  });

  it('rounds fractional terms to the nearest integer (62.5 → 63)', () => {
    // 10*3 + 8*1 + 35*(50/100) + 12*min(150,400)/400 + 10*min(3,12)/12
    //   = 30 + 8 + 17.5 + 4.5 + 2.5 = 62.5 → round 63.
    expect(
      estimateDifficulty(
        inputs({
          lineLength: 3,
          candidateFirstMoves: 1,
          forcingness: 50,
          evalSwing: 150,
          material: 3,
          depth: 25,
        }),
      ),
    ).toBe(63);
  });

  it('clamps the maximum possible score to 100', () => {
    const maxed = inputs({
      lineLength: 6,
      candidateFirstMoves: 6,
      forcingness: 100,
      evalSwing: 400,
      material: 12,
    });
    expect(estimateDifficulty({ ...maxed, depth: 25 })).toBe(100);
    expect(estimateDifficulty({ ...maxed, depth: 26 })).toBe(100);
  });
});

describe('estimateDifficulty — term caps', () => {
  it('caps the solution-length term at L = 6', () => {
    expect(estimateDifficulty(inputs({ lineLength: 6 }))).toBe(60);
    expect(estimateDifficulty(inputs({ lineLength: 12 }))).toBe(60);
    expect(estimateDifficulty(inputs({ lineLength: 3 }))).toBe(30);
  });

  it('caps the candidate-first-moves term at C = 6', () => {
    expect(estimateDifficulty(inputs({ candidateFirstMoves: 6 }))).toBe(48);
    expect(estimateDifficulty(inputs({ candidateFirstMoves: 9 }))).toBe(48);
    expect(estimateDifficulty(inputs({ candidateFirstMoves: 2 }))).toBe(16);
  });

  it('caps the evaluation-swing term at E = 400', () => {
    expect(estimateDifficulty(inputs({ evalSwing: 400 }))).toBe(12);
    expect(estimateDifficulty(inputs({ evalSwing: 1000 }))).toBe(12);
    expect(estimateDifficulty(inputs({ evalSwing: 200 }))).toBe(6);
  });

  it('caps the material term at M = 12 and rounds the fraction', () => {
    expect(estimateDifficulty(inputs({ material: 12 }))).toBe(10);
    expect(estimateDifficulty(inputs({ material: 30 }))).toBe(10);
    expect(estimateDifficulty(inputs({ material: 6 }))).toBe(5);
    expect(estimateDifficulty(inputs({ material: 3 }))).toBe(3);
  });
});

describe('estimateDifficulty — determinism', () => {
  it('is a pure function of its inputs', () => {
    const sample = inputs({
      lineLength: 5,
      candidateFirstMoves: 3,
      forcingness: 70,
      evalSwing: 250,
      material: 8,
      depth: 28,
    });
    expect(estimateDifficulty(sample)).toBe(estimateDifficulty(sample));
    expect(estimateDifficulty({ ...sample })).toBe(estimateDifficulty(sample));
  });
});
