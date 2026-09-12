import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import {
  DEFAULT_VERIFICATION_DEPTH,
  MAX_VERIFICATION_DEPTH,
} from '@/infrastructure/tactics/verificationDepth';
import { useTacticalDetectionSettings } from './useTacticalDetectionSettings';

describe('useTacticalDetectionSettings (Feature 010 W2)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('falls back to the default depth (18) when unset', async () => {
    const { result } = renderHook(() => useTacticalDetectionSettings());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.settings).toEqual({ verificationDepth: DEFAULT_VERIFICATION_DEPTH });
  });

  it('reads a stored valid value', async () => {
    await settingsRepository.set(SETTINGS_KEYS.analysisTacticalDetection, {
      verificationDepth: 30,
    });

    const { result } = renderHook(() => useTacticalDetectionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.settings).toEqual({ verificationDepth: 30 });
  });

  it('clamps an out-of-bounds stored value on read', async () => {
    await settingsRepository.set(SETTINGS_KEYS.analysisTacticalDetection, {
      verificationDepth: 999,
    });

    const { result } = renderHook(() => useTacticalDetectionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.settings).toEqual({ verificationDepth: MAX_VERIFICATION_DEPTH });
  });

  it('falls back when the stored value is invalid', async () => {
    await settingsRepository.set(SETTINGS_KEYS.analysisTacticalDetection, {
      verificationDepth: 'deep',
    });

    const { result } = renderHook(() => useTacticalDetectionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.settings).toEqual({ verificationDepth: DEFAULT_VERIFICATION_DEPTH });
  });

  it('saves and clamps the next value before persisting', async () => {
    const { result } = renderHook(() => useTacticalDetectionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.save({ verificationDepth: 30 });
    });
    expect(result.current.settings).toEqual({ verificationDepth: 30 });
    expect(await settingsRepository.get(SETTINGS_KEYS.analysisTacticalDetection)).toEqual({
      verificationDepth: 30,
    });

    await act(async () => {
      await result.current.save({ verificationDepth: 4 });
    });
    expect(result.current.settings).toEqual({ verificationDepth: 10 });
    expect(await settingsRepository.get(SETTINGS_KEYS.analysisTacticalDetection)).toEqual({
      verificationDepth: 10,
    });
  });
});
