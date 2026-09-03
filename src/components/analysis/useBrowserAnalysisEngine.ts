import { useEffect, useState } from 'react';
import {
  readBrowserCapabilities,
  type EngineCapabilities,
} from '@/infrastructure/engine/capabilities';
import { getCachedBrowserEngineService } from '@/infrastructure/engine/browser';
import type { EngineService } from '@/infrastructure/engine/types';

export interface UseBrowserAnalysisEngine {
  readonly service: EngineService | null;
  readonly capabilities: EngineCapabilities;
  readonly error: string | null;
}

/**
 * Resolves the shared session-cached browser engine service lazily. The
 * capabilities snapshot is available synchronously; the worker service is
 * fetched once (Feature 005 memoisation). Only the browser pages use this;
 * unit tests inject a fake service.
 */
export function useBrowserAnalysisEngine(): UseBrowserAnalysisEngine {
  const [service, setService] = useState<EngineService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capabilities = readBrowserCapabilities();

  useEffect(() => {
    let alive = true;
    getCachedBrowserEngineService()
      .then((resolved) => {
        if (alive) setService(resolved);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  return { service, capabilities, error };
}
