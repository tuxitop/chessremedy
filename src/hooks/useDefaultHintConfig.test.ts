import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { DEFAULT_CYCLE_CONFIG } from '@/domain/training';
import { useDefaultHintConfig } from './useDefaultHintConfig';

describe('useDefaultHintConfig (Feature 017 §7)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('falls back to DEFAULT_CYCLE_CONFIG.hints when unset', async () => {
    const { result } = renderHook(() => useDefaultHintConfig());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.hints).toEqual(DEFAULT_CYCLE_CONFIG.hints);
    expect(result.current.error).toBeNull();
  });

  it('reads and normalises a stored valid value', async () => {
    await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, {
      enabledLevels: [2, 3],
      firstHintLevel: 3,
    });

    const { result } = renderHook(() => useDefaultHintConfig());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.hints).toEqual({ enabledLevels: [2, 3], firstHintLevel: 3 });
  });

  it('accepts an empty enabledLevels ("hints off") as a valid stored value', async () => {
    await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, {
      enabledLevels: [],
      firstHintLevel: 2,
    });

    const { result } = renderHook(() => useDefaultHintConfig());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.hints).toEqual({ enabledLevels: [], firstHintLevel: 2 });
  });

  it('falls back when the stored value is invalid', async () => {
    await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, {
      enabledLevels: [9],
      firstHintLevel: 'x',
    });

    const { result } = renderHook(() => useDefaultHintConfig());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.hints).toEqual(DEFAULT_CYCLE_CONFIG.hints);
    expect(result.current.error).toBeNull();
  });

  it('saves the next value and persists it', async () => {
    const { result } = renderHook(() => useDefaultHintConfig());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.save({ enabledLevels: [1, 2], firstHintLevel: 1 });
    });

    expect(result.current.hints).toEqual({ enabledLevels: [1, 2], firstHintLevel: 1 });
    expect(await settingsRepository.get(SETTINGS_KEYS.defaultHintConfig)).toEqual({
      enabledLevels: [1, 2],
      firstHintLevel: 1,
    });
  });

  it('keeps the last value and surfaces an inline error when saving fails', async () => {
    const { result } = renderHook(() => useDefaultHintConfig());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const before = result.current.hints;

    const setSpy = vi
      .spyOn(settingsRepository, 'set')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await act(async () => {
      await result.current.save({ enabledLevels: [3], firstHintLevel: 3 });
    });
    setSpy.mockRestore();

    expect(result.current.hints).toEqual(before);
    expect(result.current.error).toMatch(/could not save/i);
  });
});
