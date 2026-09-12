import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '@/domain/chess';
import { makeMove } from './test-support';
import { effectiveClassificationOf, isExclusiveMissedTactic } from './effectiveClassification';

const CURRENT = 11;

function record(overrides: Partial<MoveAnalysis>): MoveAnalysis {
  return makeMove(0, overrides);
}

describe('isExclusiveMissedTactic', () => {
  it('is true for a current-version verified missed tactic', () => {
    const verified = record({
      classification: 'blunder',
      missedTactic: true,
      detectionVersion: CURRENT,
    });
    expect(isExclusiveMissedTactic(verified, CURRENT)).toBe(true);
  });

  it('is false for a stale (older-version) marker', () => {
    const stale = record({
      classification: 'blunder',
      missedTactic: true,
      detectionVersion: CURRENT - 1,
    });
    expect(isExclusiveMissedTactic(stale, CURRENT)).toBe(false);
  });

  it('is false when missedTactic is not set', () => {
    const notMissed = record({
      classification: 'blunder',
      missedTactic: false,
      detectionVersion: CURRENT,
    });
    expect(isExclusiveMissedTactic(notMissed, CURRENT)).toBe(false);
  });

  it('is false when detectionVersion is null', () => {
    const unverified = record({
      classification: 'blunder',
      missedTactic: true,
      detectionVersion: null,
    });
    expect(isExclusiveMissedTactic(unverified, CURRENT)).toBe(false);
  });
});

describe('effectiveClassificationOf', () => {
  it("returns 'missedTactic' for a current-version verified miss", () => {
    const verified = record({
      classification: 'mistake',
      missedTactic: true,
      detectionVersion: CURRENT,
    });
    expect(effectiveClassificationOf(verified, CURRENT)).toBe('missedTactic');
  });

  it('returns the raw classification for a stale marker', () => {
    const stale = record({
      classification: 'mistake',
      missedTactic: true,
      detectionVersion: CURRENT - 1,
    });
    expect(effectiveClassificationOf(stale, CURRENT)).toBe('mistake');
  });

  it('returns the raw classification for an ordinary record', () => {
    const ordinary = record({ classification: 'good', missedTactic: false });
    expect(effectiveClassificationOf(ordinary, CURRENT)).toBe('good');
  });
});
