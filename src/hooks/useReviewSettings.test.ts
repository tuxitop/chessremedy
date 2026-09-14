import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import {
  DEFAULT_DAILY_NEW_CAP,
  DEFAULT_DAILY_REVIEW_CAP,
  MAX_DAILY_NEW_CAP,
  MAX_DAILY_REVIEW_CAP,
} from '@/domain/review';
import { useReviewSettings } from './useReviewSettings';

describe('useReviewSettings (Feature 020 §6)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('falls back to the defaults (20 new / 100 reviews) when unset', async () => {
    const { result } = renderHook(() => useReviewSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.newCap).toBe(DEFAULT_DAILY_NEW_CAP);
    expect(result.current.reviewCap).toBe(DEFAULT_DAILY_REVIEW_CAP);
  });

  it('reads stored valid values including 0', async () => {
    await settingsRepository.set(SETTINGS_KEYS.reviewDailyNewCap, 0);
    await settingsRepository.set(SETTINGS_KEYS.reviewDailyReviewCap, 50);
    const { result } = renderHook(() => useReviewSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.newCap).toBe(0);
    expect(result.current.reviewCap).toBe(50);
  });

  it('falls back when the stored values are invalid', async () => {
    await settingsRepository.set(SETTINGS_KEYS.reviewDailyNewCap, 'many');
    await settingsRepository.set(SETTINGS_KEYS.reviewDailyReviewCap, null);
    const { result } = renderHook(() => useReviewSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.newCap).toBe(DEFAULT_DAILY_NEW_CAP);
    expect(result.current.reviewCap).toBe(DEFAULT_DAILY_REVIEW_CAP);
  });

  it('clamps stored values above the safety maximum', async () => {
    await settingsRepository.set(SETTINGS_KEYS.reviewDailyNewCap, 999_999);
    await settingsRepository.set(SETTINGS_KEYS.reviewDailyReviewCap, 999_999);
    const { result } = renderHook(() => useReviewSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.newCap).toBe(MAX_DAILY_NEW_CAP);
    expect(result.current.reviewCap).toBe(MAX_DAILY_REVIEW_CAP);
  });

  it('saves clamped values and round-trips them', async () => {
    const { result } = renderHook(() => useReviewSettings());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.save({ newCap: 5, reviewCap: 0 });
    });
    expect(result.current.newCap).toBe(5);
    expect(result.current.reviewCap).toBe(0);
    expect(await settingsRepository.get(SETTINGS_KEYS.reviewDailyNewCap)).toBe(5);
    expect(await settingsRepository.get(SETTINGS_KEYS.reviewDailyReviewCap)).toBe(0);

    await act(async () => {
      await result.current.save({ newCap: -3, reviewCap: 999_999 });
    });
    expect(result.current.newCap).toBe(0);
    expect(result.current.reviewCap).toBe(MAX_DAILY_REVIEW_CAP);
  });
});
