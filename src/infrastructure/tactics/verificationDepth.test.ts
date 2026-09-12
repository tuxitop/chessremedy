import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERIFICATION_DEPTH,
  MAX_VERIFICATION_DEPTH,
  MIN_VERIFICATION_DEPTH,
  clampTacticalDetectionSettings,
  clampVerificationDepth,
  defaultTacticalDetectionSettings,
} from './verificationDepth';

describe('verification-depth setting (Feature 010 W2)', () => {
  it('exposes the ADR-026 defaults and bounds', () => {
    expect(DEFAULT_VERIFICATION_DEPTH).toBe(18);
    expect(MIN_VERIFICATION_DEPTH).toBe(10);
    expect(MAX_VERIFICATION_DEPTH).toBe(40);
  });

  it('clamps a numeric depth into [10, 40]', () => {
    expect(clampVerificationDepth(22)).toBe(22);
    expect(clampVerificationDepth(10)).toBe(10);
    expect(clampVerificationDepth(40)).toBe(40);
    expect(clampVerificationDepth(9)).toBe(10);
    expect(clampVerificationDepth(41)).toBe(40);
    expect(clampVerificationDepth(999)).toBe(40);
  });

  it('rounds a fractional depth', () => {
    expect(clampVerificationDepth(22.4)).toBe(22);
    expect(clampVerificationDepth(22.6)).toBe(23);
  });

  it('falls back to the default for an absent or invalid value', () => {
    expect(clampVerificationDepth(undefined)).toBe(DEFAULT_VERIFICATION_DEPTH);
    expect(clampVerificationDepth(null)).toBe(DEFAULT_VERIFICATION_DEPTH);
    expect(clampVerificationDepth('30')).toBe(DEFAULT_VERIFICATION_DEPTH);
    expect(clampVerificationDepth(Number.NaN)).toBe(DEFAULT_VERIFICATION_DEPTH);
    expect(clampVerificationDepth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VERIFICATION_DEPTH);
    expect(clampVerificationDepth({})).toBe(DEFAULT_VERIFICATION_DEPTH);
  });

  it('builds the default settings and normalises arbitrary stored values', () => {
    expect(defaultTacticalDetectionSettings()).toEqual({
      verificationDepth: DEFAULT_VERIFICATION_DEPTH,
    });
    expect(clampTacticalDetectionSettings({ verificationDepth: 30 })).toEqual({
      verificationDepth: 30,
    });
    expect(clampTacticalDetectionSettings({ verificationDepth: 3 })).toEqual({
      verificationDepth: MIN_VERIFICATION_DEPTH,
    });
    expect(clampTacticalDetectionSettings(undefined)).toEqual({
      verificationDepth: DEFAULT_VERIFICATION_DEPTH,
    });
    expect(clampTacticalDetectionSettings('nope')).toEqual({
      verificationDepth: DEFAULT_VERIFICATION_DEPTH,
    });
  });
});
