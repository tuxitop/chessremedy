import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import {
  clampTacticalDetectionSettings,
  defaultTacticalDetectionSettings,
  type TacticalDetectionSettings,
} from '@/infrastructure/tactics/verificationDepth';

export interface UseTacticalDetectionSettings {
  readonly settings: TacticalDetectionSettings | null;
  /** True once the stored settings have been read (fallback applied). */
  readonly isReady: boolean;
  save(next: TacticalDetectionSettings): Promise<void>;
}

/**
 * Reads and writes the persisted tactical-detection settings (Settings page)
 * used by the Feature-010 Stage-2 verification pass. The stored value is
 * clamped on read; an absent/invalid value falls back to the default depth
 * (22). `save` clamps before persisting so an out-of-bounds value can never be
 * stored.
 */
export function useTacticalDetectionSettings(): UseTacticalDetectionSettings {
  const [settings, setSettings] = useState<TacticalDetectionSettings | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await settingsRepository.get<TacticalDetectionSettings>(
        SETTINGS_KEYS.analysisTacticalDetection,
      );
      if (cancelled) {
        return;
      }
      setSettings(
        stored ? clampTacticalDetectionSettings(stored) : defaultTacticalDetectionSettings(),
      );
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: TacticalDetectionSettings) => {
    const clamped = clampTacticalDetectionSettings(next);
    setSettings(clamped);
    await settingsRepository.set(SETTINGS_KEYS.analysisTacticalDetection, clamped);
  }, []);

  return { settings, isReady, save };
}
