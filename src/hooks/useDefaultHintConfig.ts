import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { DEFAULT_CYCLE_CONFIG, validateHintConfig, type HintConfig } from '@/domain/training';

export interface UseDefaultHintConfig {
  /** The stored global hint default (fallback `DEFAULT_CYCLE_CONFIG.hints`). */
  readonly hints: HintConfig;
  /** True once the stored value has been read (fallback applied). */
  readonly isReady: boolean;
  /** Inline save error; `null` while healthy. */
  readonly error: string | null;
  save(next: HintConfig): Promise<void>;
}

/**
 * Reads and writes the global default hint configuration
 * (`SETTINGS_KEYS.defaultHintConfig` = `training.hints`) used to seed **new**
 * training sets and Woodpecker blocks (Feature 017 §7).
 *
 * An unset or invalid stored value falls back to `DEFAULT_CYCLE_CONFIG.hints`
 * (never a user-facing error); a save failure keeps the last value and surfaces
 * an inline error rather than silently claiming success.
 */
export function useDefaultHintConfig(): UseDefaultHintConfig {
  const [hints, setHints] = useState<HintConfig>(DEFAULT_CYCLE_CONFIG.hints);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintsRef = useRef(hints);
  useEffect(() => {
    hintsRef.current = hints;
  }, [hints]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let resolved: HintConfig = DEFAULT_CYCLE_CONFIG.hints;
      try {
        const stored = await settingsRepository.get<unknown>(SETTINGS_KEYS.defaultHintConfig);
        if (stored !== undefined) {
          const check = validateHintConfig(stored);
          if (check.ok) {
            resolved = check.config;
          }
        }
      } catch {
        resolved = DEFAULT_CYCLE_CONFIG.hints;
      }
      if (cancelled) {
        return;
      }
      setHints(resolved);
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: HintConfig) => {
    const previous = hintsRef.current;
    setError(null);
    setHints(next);
    try {
      await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, next);
    } catch {
      setHints(previous);
      setError('Could not save the puzzle hint default. Please try again.');
    }
  }, []);

  return { hints, isReady, error, save };
}
