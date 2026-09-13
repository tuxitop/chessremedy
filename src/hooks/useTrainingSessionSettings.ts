import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { DEFAULT_SESSION_DURATION_MS, DEFAULT_SESSION_WARNING_MS } from '@/domain/training';

/** Default session length in minutes, derived from the domain default (10 min). */
export const DEFAULT_SESSION_DURATION_MINUTES = DEFAULT_SESSION_DURATION_MS / 60_000;

/** Default session warning threshold in seconds, from the domain default (30 s). */
export const DEFAULT_SESSION_WARNING_SECONDS = DEFAULT_SESSION_WARNING_MS / 1000;

/** Stored-value bounds for the default session length, in minutes. */
export const MIN_SESSION_DURATION_MINUTES = 1;
export const MAX_SESSION_DURATION_MINUTES = 180;

/** Stored-value bounds for the session warning threshold, in seconds. */
export const MIN_SESSION_WARNING_SECONDS = 5;
export const MAX_SESSION_WARNING_SECONDS = 600;

export interface UseTrainingSessionSettings {
  /** Preselected session length in millis (default 10 min). */
  readonly defaultDurationMs: number;
  /** Remaining-time warning threshold in millis (default 30 s). */
  readonly warningMs: number;
  /** True once the stored values have been read (fallbacks applied). */
  readonly isReady: boolean;
  save(next: { defaultMinutes: number; warningSeconds: number }): Promise<void>;
}

/** Clamp a finite minutes value into the stored bounds; non-finite → default. */
function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) {
    return DEFAULT_SESSION_DURATION_MINUTES;
  }
  return Math.min(
    MAX_SESSION_DURATION_MINUTES,
    Math.max(MIN_SESSION_DURATION_MINUTES, Math.round(minutes)),
  );
}

/** Clamp a finite seconds value into the stored bounds; non-finite → default. */
function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return DEFAULT_SESSION_WARNING_SECONDS;
  }
  return Math.min(
    MAX_SESSION_WARNING_SECONDS,
    Math.max(MIN_SESSION_WARNING_SECONDS, Math.round(seconds)),
  );
}

/** Normalise a stored value: absent/invalid falls back, a valid number clamps. */
function normalizeStoredMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SESSION_DURATION_MINUTES;
  }
  return clampMinutes(value);
}

/** Normalise a stored value: absent/invalid falls back, a valid number clamps. */
function normalizeStoredSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SESSION_WARNING_SECONDS;
  }
  return clampSeconds(value);
}

/**
 * Reads and writes the persisted timed-training session settings (Settings page
 * → Puzzles): the default session length (integer minutes) and the warning
 * threshold (integer seconds). Unset/invalid values fall back to the domain
 * defaults (10 min / 30 s); valid values clamp to 1–180 min and 5–600 s. `save`
 * clamps and persists the raw whole minutes/seconds.
 */
export function useTrainingSessionSettings(): UseTrainingSessionSettings {
  const [defaultDurationMs, setDefaultDurationMs] = useState(DEFAULT_SESSION_DURATION_MS);
  const [warningMs, setWarningMs] = useState(DEFAULT_SESSION_WARNING_MS);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedMinutes, storedWarning] = await Promise.all([
        settingsRepository.get<number>(SETTINGS_KEYS.sessionDefaultMinutes),
        settingsRepository.get<number>(SETTINGS_KEYS.sessionWarningSeconds),
      ]);
      if (cancelled) {
        return;
      }
      setDefaultDurationMs(normalizeStoredMinutes(storedMinutes) * 60_000);
      setWarningMs(normalizeStoredSeconds(storedWarning) * 1000);
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: { defaultMinutes: number; warningSeconds: number }) => {
    const minutes = clampMinutes(next.defaultMinutes);
    const seconds = clampSeconds(next.warningSeconds);
    setDefaultDurationMs(minutes * 60_000);
    setWarningMs(seconds * 1000);
    await Promise.all([
      settingsRepository.set(SETTINGS_KEYS.sessionDefaultMinutes, minutes),
      settingsRepository.set(SETTINGS_KEYS.sessionWarningSeconds, seconds),
    ]);
  }, []);

  return { defaultDurationMs, warningMs, isReady, save };
}
