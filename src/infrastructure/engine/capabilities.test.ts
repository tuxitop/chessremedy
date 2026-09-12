import { describe, expect, it } from 'vitest';
import {
  MAX_THREADS_CAP,
  VERIFICATION_THREADS,
  analysisThreadCap,
  canMultiThread,
  globalThreadBudget,
  resolveEngineCapabilities,
  verificationCapabilities,
  verificationThreadCap,
} from './capabilities';
import type { CapabilityEnvironment, EngineCapabilities } from './capabilities';

function env(overrides: Partial<CapabilityEnvironment> = {}): CapabilityEnvironment {
  return {
    sharedArrayBuffer: true,
    crossOriginIsolated: true,
    hardwareConcurrency: 8,
    touchPoints: 0,
    coarsePointer: false,
    ...overrides,
  };
}

const MULTI_CAPS: EngineCapabilities = {
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  hardwareConcurrency: 8,
  isMobile: false,
  build: 'lite',
  threads: 7,
  hashCapMb: 256,
};

describe('global thread budget (ADR-034)', () => {
  it('exposes the ADR-012 cap and the reserved verification thread', () => {
    expect(MAX_THREADS_CAP).toBe(8);
    expect(VERIFICATION_THREADS).toBe(1);
    expect(verificationThreadCap()).toBe(1);
  });

  it('only allows multi-threading under isolation, SharedArrayBuffer and >1 core', () => {
    expect(canMultiThread(env())).toBe(true);
    expect(canMultiThread(env({ crossOriginIsolated: false }))).toBe(false);
    expect(canMultiThread(env({ sharedArrayBuffer: false }))).toBe(false);
    expect(canMultiThread(env({ hardwareConcurrency: 1 }))).toBe(false);
  });

  it('computes B from the cap and core count', () => {
    expect(globalThreadBudget(true, 8)).toBe(8);
    expect(globalThreadBudget(true, 16)).toBe(MAX_THREADS_CAP);
    expect(globalThreadBudget(true, 2)).toBe(2);
    expect(globalThreadBudget(false, 8)).toBe(1);
  });

  it('keeps analysis + verification within the budget on the multi-threaded build', () => {
    for (const hc of [2, 4, 8, 16]) {
      const budget = globalThreadBudget(true, hc);
      expect(analysisThreadCap(budget) + VERIFICATION_THREADS).toBeLessThanOrEqual(budget);
    }
  });

  it('does not apply the arithmetic budget to the single-threaded build', () => {
    // ADR-034: both engines run lite-single with exactly 1 thread; the OS
    // schedules the two workers.
    const budget = globalThreadBudget(false, 1);
    expect(budget).toBe(1);
    expect(analysisThreadCap(budget)).toBe(1);
  });
});

describe('resolveEngineCapabilities thread budget', () => {
  it('isolated 8-core → lite with analysis cap 7', () => {
    const caps = resolveEngineCapabilities(env({ hardwareConcurrency: 8 }));
    expect(caps.build).toBe('lite');
    expect(caps.threads).toBe(7);
  });

  it('isolated 2-core → lite with analysis cap 1', () => {
    const caps = resolveEngineCapabilities(env({ hardwareConcurrency: 2 }));
    expect(caps.build).toBe('lite');
    expect(caps.threads).toBe(1);
  });

  it('isolated 16-core → lite capped at 7', () => {
    const caps = resolveEngineCapabilities(env({ hardwareConcurrency: 16 }));
    expect(caps.build).toBe('lite');
    expect(caps.threads).toBe(7);
  });

  it('non-isolated 8-core → lite-single with 1 thread', () => {
    const caps = resolveEngineCapabilities(env({ crossOriginIsolated: false }));
    expect(caps.build).toBe('lite-single');
    expect(caps.threads).toBe(1);
  });

  it('isolated 1-core → lite-single with 1 thread', () => {
    const caps = resolveEngineCapabilities(env({ hardwareConcurrency: 1 }));
    expect(caps.build).toBe('lite-single');
    expect(caps.threads).toBe(1);
  });
});

describe('verificationCapabilities', () => {
  it('pins the verification engine to 1 thread and preserves the build/hash', () => {
    const caps = verificationCapabilities(MULTI_CAPS);
    expect(caps.threads).toBe(1);
    expect(caps.build).toBe('lite');
    expect(caps.hashCapMb).toBe(256);
    expect(caps.hardwareConcurrency).toBe(8);
  });

  it('does not mutate the source capabilities', () => {
    const caps = verificationCapabilities(MULTI_CAPS);
    expect(caps).not.toBe(MULTI_CAPS);
    expect(MULTI_CAPS.threads).toBe(7);
  });
});
