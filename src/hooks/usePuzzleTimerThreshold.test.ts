import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import {
  DEFAULT_PUZZLE_RED_THRESHOLD_SECONDS,
  MAX_PUZZLE_RED_THRESHOLD_SECONDS,
  MIN_PUZZLE_RED_THRESHOLD_SECONDS,
  usePuzzleTimerThreshold,
} from './usePuzzleTimerThreshold';

describe('usePuzzleTimerThreshold (Feature 019 §8)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('falls back to the default (30 s) when unset', async () => {
    const { result } = renderHook(() => usePuzzleTimerThreshold());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.thresholdMs).toBe(DEFAULT_PUZZLE_RED_THRESHOLD_SECONDS * 1000);
    expect(result.current.thresholdMs).toBe(30_000);
  });

  it('reads a stored valid value (seconds)', async () => {
    await settingsRepository.set(SETTINGS_KEYS.puzzleTimerRedThreshold, 45);

    const { result } = renderHook(() => usePuzzleTimerThreshold());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.thresholdMs).toBe(45_000);
  });

  it('clamps an out-of-range stored value on read', async () => {
    await settingsRepository.set(SETTINGS_KEYS.puzzleTimerRedThreshold, 999);

    const { result } = renderHook(() => usePuzzleTimerThreshold());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.thresholdMs).toBe(MAX_PUZZLE_RED_THRESHOLD_SECONDS * 1000);
  });

  it('falls back when the stored value is invalid', async () => {
    await settingsRepository.set(SETTINGS_KEYS.puzzleTimerRedThreshold, 'fast');

    const { result } = renderHook(() => usePuzzleTimerThreshold());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.thresholdMs).toBe(DEFAULT_PUZZLE_RED_THRESHOLD_SECONDS * 1000);
  });

  it('saves and clamps the next value before persisting whole seconds', async () => {
    const { result } = renderHook(() => usePuzzleTimerThreshold());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.save(45_000);
    });
    expect(result.current.thresholdMs).toBe(45_000);
    expect(await settingsRepository.get(SETTINGS_KEYS.puzzleTimerRedThreshold)).toBe(45);

    await act(async () => {
      await result.current.save(1_000);
    });
    expect(result.current.thresholdMs).toBe(MIN_PUZZLE_RED_THRESHOLD_SECONDS * 1000);
    expect(await settingsRepository.get(SETTINGS_KEYS.puzzleTimerRedThreshold)).toBe(
      MIN_PUZZLE_RED_THRESHOLD_SECONDS,
    );

    await act(async () => {
      await result.current.save(999_000);
    });
    expect(result.current.thresholdMs).toBe(MAX_PUZZLE_RED_THRESHOLD_SECONDS * 1000);
    expect(await settingsRepository.get(SETTINGS_KEYS.puzzleTimerRedThreshold)).toBe(
      MAX_PUZZLE_RED_THRESHOLD_SECONDS,
    );
  });
});
