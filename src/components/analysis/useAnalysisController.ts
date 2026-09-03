import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import type { AnalysisProfile } from '@/domain/chess';
import {
  analysisOptionsFromSettings,
  defaultLiveSettings,
  settingsWithProfile,
  type LiveEngineSettings,
} from './engineSettings';
import { useLiveAnalysis, type LiveAnalysisState, type LiveEngineService } from './useLiveAnalysis';

export interface AnalysisControllerOptions {
  readonly service: LiveEngineService | null;
  readonly fen: string | null;
  readonly capabilities: EngineCapabilities | null;
  /** Start the engine immediately (live board) vs off (playground). */
  readonly autoStart: boolean;
  /** Persisted defaults from the Settings page; falls back to profile defaults. */
  readonly defaults?: LiveEngineSettings | null;
}

export interface AnalysisController extends LiveAnalysisState {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  readonly settings: LiveEngineSettings;
  setSettings(next: LiveEngineSettings): void;
  /** Apply a profile preset onto the current settings. */
  applyProfile(profile: AnalysisProfile): void;
}

const FALLBACK_CAPS: EngineCapabilities = {
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  hardwareConcurrency: 1,
  isMobile: false,
  build: 'lite-single',
  threads: 1,
  hashCapMb: 256,
};

function capsOrFallback(capabilities: EngineCapabilities | null): EngineCapabilities {
  return capabilities ?? FALLBACK_CAPS;
}

/**
 * Owns the enabled switch, the engine settings and the live-analysis job for a
 * position. Feeding both the evaluation bar and the analysis panel from this
 * single controller keeps the header eval text and the bar consistent.
 */
export function useAnalysisController({
  service,
  fen,
  capabilities,
  autoStart,
  defaults = null,
}: AnalysisControllerOptions): AnalysisController {
  const [enabled, setEnabled] = useState(autoStart);
  const caps = capsOrFallback(capabilities);
  const [settings, setSettingsState] = useState<LiveEngineSettings>(() =>
    defaults ? defaults : defaultLiveSettings(caps),
  );
  const userTouched = useRef(false);

  // Adopt Settings-page defaults once they arrive (async read), unless the
  // user has already customised the session controls. Threads/memory are
  // re-clamped to this device's capabilities.
  useEffect(() => {
    if (defaults && !userTouched.current) {
      setSettingsState({
        engine: defaults.engine,
        profile: defaults.profile,
        depth: defaults.depth,
        searchSeconds: defaults.searchSeconds,
        lines: defaults.lines,
        threads: Math.min(defaults.threads, caps.threads),
        memoryMb: Math.min(defaults.memoryMb, caps.hashCapMb),
        arrows: defaults.arrows,
      });
    }
    // `caps` is stable per session; defaults change only while loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults]);

  const options = useMemo(() => analysisOptionsFromSettings(settings), [settings]);

  const live = useLiveAnalysis({ service, fen, enabled, options });

  const applyProfile = useCallback(
    (profile: AnalysisProfile) => {
      userTouched.current = true;
      setSettingsState((current) =>
        settingsWithProfile(current, profile, capsOrFallback(capabilities)),
      );
    },
    [capabilities],
  );

  const setSettings = useCallback((next: LiveEngineSettings) => {
    userTouched.current = true;
    setSettingsState(next);
  }, []);

  return {
    ...live,
    enabled,
    setEnabled,
    settings,
    setSettings,
    applyProfile,
  };
}
