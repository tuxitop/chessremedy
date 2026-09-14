/**
 * Feature 020 — review daily-cap settings hook.
 *
 * Reads/writes the two review caps in the existing `settings` store (no schema
 * change). Unset/invalid values fall back to the domain defaults; a value above
 * the documented safety maximum is clamped; `0` is valid (pauses a category).
 */

import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { DEFAULT_DAILY_NEW_CAP, DEFAULT_DAILY_REVIEW_CAP, normalizeCaps } from '@/domain/review';

export { MAX_DAILY_NEW_CAP, MAX_DAILY_REVIEW_CAP } from '@/domain/review';

export interface UseReviewSettings {
  /** Daily new-puzzle cap in force (default 20). */
  readonly newCap: number;
  /** Daily review cap in force (default 100). */
  readonly reviewCap: number;
  /** True once the stored values have been read (fallbacks applied). */
  readonly isReady: boolean;
  /** Normalize, persist and apply the next caps. */
  save(next: { newCap: number; reviewCap: number }): Promise<void>;
}

/**
 * Read and write the persisted review caps. `save` clamps/falls back exactly
 * like the read path before persisting, so the stored value is always valid.
 */
export function useReviewSettings(): UseReviewSettings {
  const [newCap, setNewCap] = useState(DEFAULT_DAILY_NEW_CAP);
  const [reviewCap, setReviewCap] = useState(DEFAULT_DAILY_REVIEW_CAP);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedNew, storedReview] = await Promise.all([
        settingsRepository.get<number>(SETTINGS_KEYS.reviewDailyNewCap),
        settingsRepository.get<number>(SETTINGS_KEYS.reviewDailyReviewCap),
      ]);
      if (cancelled) {
        return;
      }
      const caps = normalizeCaps({ newCap: storedNew, reviewCap: storedReview });
      setNewCap(caps.newCap);
      setReviewCap(caps.reviewCap);
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: { newCap: number; reviewCap: number }) => {
    const caps = normalizeCaps({ newCap: next.newCap, reviewCap: next.reviewCap });
    setNewCap(caps.newCap);
    setReviewCap(caps.reviewCap);
    await Promise.all([
      settingsRepository.set(SETTINGS_KEYS.reviewDailyNewCap, caps.newCap),
      settingsRepository.set(SETTINGS_KEYS.reviewDailyReviewCap, caps.reviewCap),
    ]);
  }, []);

  return { newCap, reviewCap, isReady, save };
}
