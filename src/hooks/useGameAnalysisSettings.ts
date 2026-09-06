import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import {
  defaultGameAnalysisSettings,
  type GameAnalysisSettings,
} from '@/components/analysis/gameAnalysisSettings';

export interface UseGameAnalysisSettings {
  readonly settings: GameAnalysisSettings | null;
  /** True once the stored settings have been read (fallback applied). */
  readonly isReady: boolean;
  save(next: GameAnalysisSettings): Promise<void>;
}

function clampStored(stored: GameAnalysisSettings): GameAnalysisSettings {
  const fallback = defaultGameAnalysisSettings();
  return {
    engine: stored.engine ?? fallback.engine,
    profile: stored.profile ?? fallback.profile,
    depthOverride: stored.depthOverride ?? null,
    searchSeconds: stored.searchSeconds ?? null,
  };
}

/**
 * Reads and writes the persisted Game-analysis settings (Settings page) used
 * by bulk/per-row game analysis and Review re-analysis.
 */
export function useGameAnalysisSettings(): UseGameAnalysisSettings {
  const [settings, setSettings] = useState<GameAnalysisSettings | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await settingsRepository.get<GameAnalysisSettings>(SETTINGS_KEYS.analysisGame);
      if (cancelled) return;
      setSettings(stored ? clampStored(stored) : defaultGameAnalysisSettings());
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: GameAnalysisSettings) => {
    setSettings(next);
    await settingsRepository.set(SETTINGS_KEYS.analysisGame, next);
  }, []);

  return { settings, isReady, save };
}
