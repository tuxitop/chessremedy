import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { readBrowserCapabilities } from '@/infrastructure/engine/capabilities';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import { defaultLiveSettings, type LiveEngineSettings } from '@/components/analysis/engineSettings';

export interface UseEngineDefaults {
  readonly defaults: LiveEngineSettings | null;
  /** True once the stored defaults have been read (fallback applied). */
  readonly isReady: boolean;
  save(next: LiveEngineSettings): Promise<void>;
}

/**
 * Reads and writes the persisted engine-config defaults (Settings page) used
 * to initialise the live-analysis controller and the playground.
 */
export function useEngineDefaults(): UseEngineDefaults {
  const [defaults, setDefaults] = useState<LiveEngineSettings | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const caps: EngineCapabilities = readBrowserCapabilities();
      const stored = await settingsRepository.get<LiveEngineSettings>(SETTINGS_KEYS.engineDefaults);
      if (cancelled) return;
      setDefaults(
        stored
          ? {
              ...stored,
              threads: Math.min(stored.threads, Math.max(1, caps.threads)),
              memoryMb: Math.min(stored.memoryMb, caps.hashCapMb),
            }
          : defaultLiveSettings(caps),
      );
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: LiveEngineSettings) => {
    setDefaults(next);
    await settingsRepository.set(SETTINGS_KEYS.engineDefaults, next);
  }, []);

  return { defaults, isReady, save };
}
