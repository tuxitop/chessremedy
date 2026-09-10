import { describe, expect, it } from 'vitest';
import {
  CYCLE_CONFIG_VERSION,
  CYCLE_METRICS_VERSION,
  DEFAULT_CYCLE_CONFIG,
  DEFAULT_TARGET_SIZE,
} from './cycleTypes';

describe('Feature-013 cycle vocabulary', () => {
  it('stamps the initial config and metrics versions', () => {
    expect(CYCLE_CONFIG_VERSION).toBe(1);
    expect(CYCLE_METRICS_VERSION).toBe(1);
    expect(DEFAULT_CYCLE_CONFIG.configVersion).toBe(CYCLE_CONFIG_VERSION);
  });

  it('uses the documented default target size', () => {
    expect(DEFAULT_TARGET_SIZE).toBe(10);
  });

  it('defaults ordering, retry mode, skip and unset informational targets', () => {
    expect(DEFAULT_CYCLE_CONFIG.ordering).toBe('difficultyAsc');
    expect(DEFAULT_CYCLE_CONFIG.retryFailed).toBe('endOfCycle');
    expect(DEFAULT_CYCLE_CONFIG.allowSkip).toBe(true);
    expect(DEFAULT_CYCLE_CONFIG.targetAccuracy).toBeNull();
    expect(DEFAULT_CYCLE_CONFIG.targetSolvingTimeMs).toBeNull();
    expect(DEFAULT_CYCLE_CONFIG.plannedCycles).toBeNull();
  });

  it('enables all four hint levels but starts the first press at level 2', () => {
    expect(DEFAULT_CYCLE_CONFIG.hints.enabledLevels).toEqual([1, 2, 3, 4]);
    expect(DEFAULT_CYCLE_CONFIG.hints.firstHintLevel).toBe(2);
  });
});
