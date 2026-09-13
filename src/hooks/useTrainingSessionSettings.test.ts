import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import {
  DEFAULT_SESSION_DURATION_MINUTES,
  DEFAULT_SESSION_WARNING_SECONDS,
  MAX_SESSION_DURATION_MINUTES,
  MAX_SESSION_WARNING_SECONDS,
  MIN_SESSION_DURATION_MINUTES,
  MIN_SESSION_WARNING_SECONDS,
  useTrainingSessionSettings,
} from './useTrainingSessionSettings';

describe('useTrainingSessionSettings (Feature 019 §8)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('falls back to the defaults (10 min / 30 s) when unset', async () => {
    const { result } = renderHook(() => useTrainingSessionSettings());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.defaultDurationMs).toBe(DEFAULT_SESSION_DURATION_MINUTES * 60_000);
    expect(result.current.defaultDurationMs).toBe(600_000);
    expect(result.current.warningMs).toBe(DEFAULT_SESSION_WARNING_SECONDS * 1000);
    expect(result.current.warningMs).toBe(30_000);
  });

  it('reads stored valid values (minutes / seconds)', async () => {
    await settingsRepository.set(SETTINGS_KEYS.sessionDefaultMinutes, 15);
    await settingsRepository.set(SETTINGS_KEYS.sessionWarningSeconds, 45);

    const { result } = renderHook(() => useTrainingSessionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.defaultDurationMs).toBe(900_000);
    expect(result.current.warningMs).toBe(45_000);
  });

  it('clamps out-of-range stored values on read', async () => {
    await settingsRepository.set(SETTINGS_KEYS.sessionDefaultMinutes, 999);
    await settingsRepository.set(SETTINGS_KEYS.sessionWarningSeconds, 1);

    const { result } = renderHook(() => useTrainingSessionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.defaultDurationMs).toBe(MAX_SESSION_DURATION_MINUTES * 60_000);
    expect(result.current.warningMs).toBe(MIN_SESSION_WARNING_SECONDS * 1000);
  });

  it('falls back when the stored values are invalid', async () => {
    await settingsRepository.set(SETTINGS_KEYS.sessionDefaultMinutes, 'long');
    await settingsRepository.set(SETTINGS_KEYS.sessionWarningSeconds, null);

    const { result } = renderHook(() => useTrainingSessionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.defaultDurationMs).toBe(DEFAULT_SESSION_DURATION_MINUTES * 60_000);
    expect(result.current.warningMs).toBe(DEFAULT_SESSION_WARNING_SECONDS * 1000);
  });

  it('saves and clamps the next value before persisting raw minutes/seconds', async () => {
    const { result } = renderHook(() => useTrainingSessionSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.save({ defaultMinutes: 15, warningSeconds: 45 });
    });
    expect(result.current.defaultDurationMs).toBe(900_000);
    expect(result.current.warningMs).toBe(45_000);
    expect(await settingsRepository.get(SETTINGS_KEYS.sessionDefaultMinutes)).toBe(15);
    expect(await settingsRepository.get(SETTINGS_KEYS.sessionWarningSeconds)).toBe(45);

    await act(async () => {
      await result.current.save({ defaultMinutes: 0, warningSeconds: 9_999 });
    });
    expect(result.current.defaultDurationMs).toBe(MIN_SESSION_DURATION_MINUTES * 60_000);
    expect(result.current.warningMs).toBe(MAX_SESSION_WARNING_SECONDS * 1000);
    expect(await settingsRepository.get(SETTINGS_KEYS.sessionDefaultMinutes)).toBe(
      MIN_SESSION_DURATION_MINUTES,
    );
    expect(await settingsRepository.get(SETTINGS_KEYS.sessionWarningSeconds)).toBe(
      MAX_SESSION_WARNING_SECONDS,
    );
  });
});
