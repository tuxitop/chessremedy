import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { DEFAULT_PUZZLE_RED_MS } from '@/domain/training';

/** Default red threshold in seconds, derived from the domain default (30 s). */
export const DEFAULT_PUZZLE_RED_THRESHOLD_SECONDS = DEFAULT_PUZZLE_RED_MS / 1000;

/** Stored-value bounds for the red threshold, in seconds. */
export const MIN_PUZZLE_RED_THRESHOLD_SECONDS = 5;
export const MAX_PUZZLE_RED_THRESHOLD_SECONDS = 600;

export interface UsePuzzleTimerThreshold {
  /** Elapsed time (millis) at which the solve clock turns red. */
  readonly thresholdMs: number;
  /** True once the stored value has been read (fallback applied). */
  readonly isReady: boolean;
  save(thresholdMs: number): Promise<void>;
}

/** Clamp a finite seconds value into the stored bounds; non-finite → default. */
function clampThresholdSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return DEFAULT_PUZZLE_RED_THRESHOLD_SECONDS;
  }
  return Math.min(
    MAX_PUZZLE_RED_THRESHOLD_SECONDS,
    Math.max(MIN_PUZZLE_RED_THRESHOLD_SECONDS, Math.round(seconds)),
  );
}

/** Normalise a stored value: absent/invalid falls back, a valid number clamps. */
function normalizeStoredSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PUZZLE_RED_THRESHOLD_SECONDS;
  }
  return clampThresholdSeconds(value);
}

/**
 * Reads and writes the persisted "Puzzle timer red threshold" setting (Settings
 * page → Puzzles), stored as integer seconds. Unset/invalid values fall back to
 * the domain default (30 s); valid values are clamped to 5–600 s. `save` accepts
 * millis and persists whole seconds so an out-of-range value is never stored.
 */
export function usePuzzleTimerThreshold(): UsePuzzleTimerThreshold {
  const [thresholdMs, setThresholdMs] = useState(DEFAULT_PUZZLE_RED_MS);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await settingsRepository.get<number>(SETTINGS_KEYS.puzzleTimerRedThreshold);
      if (cancelled) {
        return;
      }
      setThresholdMs(normalizeStoredSeconds(stored) * 1000);
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (nextMs: number) => {
    const seconds = clampThresholdSeconds(nextMs / 1000);
    setThresholdMs(seconds * 1000);
    await settingsRepository.set(SETTINGS_KEYS.puzzleTimerRedThreshold, seconds);
  }, []);

  return { thresholdMs, isReady, save };
}
