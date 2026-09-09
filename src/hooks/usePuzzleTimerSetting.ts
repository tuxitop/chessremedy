import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';

export interface UsePuzzleTimerSetting {
  /** Show the solve clock on the puzzle screen; default hidden (off). */
  readonly showPuzzleTimer: boolean;
  /** True once the stored value has been read (fallback applied). */
  readonly isReady: boolean;
  save(next: boolean): Promise<void>;
}

/**
 * Reads and writes the persisted "Show puzzle timer" setting (Settings page →
 * Puzzles). The solve clock is hidden by default; when off the solve view does
 * not render it at all.
 */
export function usePuzzleTimerSetting(): UsePuzzleTimerSetting {
  const [showPuzzleTimer, setShowPuzzleTimer] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await settingsRepository.get<boolean>(SETTINGS_KEYS.puzzleTimer);
      if (cancelled) {
        return;
      }
      setShowPuzzleTimer(stored ?? false);
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: boolean) => {
    setShowPuzzleTimer(next);
    await settingsRepository.set(SETTINGS_KEYS.puzzleTimer, next);
  }, []);

  return { showPuzzleTimer, isReady, save };
}
