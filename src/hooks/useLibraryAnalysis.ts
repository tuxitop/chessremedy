import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameAnalysisStatus } from '@/domain/analysis';
import { SETTINGS_KEYS } from '@/config/app-config';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { useGameAnalysis, type AnalysisServiceLike } from './useGameAnalysis';

export interface LibraryAnalysisApi {
  /** Per-game analysis status for the currently displayed rows. */
  readonly statuses: Readonly<Record<string, GameAnalysisStatus>>;
  /** True while a batch run is active (progress bar is live). */
  readonly running: boolean;
  /** Aggregate progress while running: finished of queued+active jobs. */
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly error: string | null;
  readonly enabled: boolean;
  analyze(ids: readonly string[]): void;
  retry(gameId: string): void;
  cancel(): void;
}

type BulkProfile = 'fast' | 'normal' | 'deep';

/**
 * The profile used for bulk game analysis: the user's configured engine
 * default when it is one of `fast`/`normal`/`deep`. The `tactical` profile is
 * reserved for verification (Feature 010) and never used for bulk analysis
 * (Feature 008 §3); an absent/unset default falls back to `normal`.
 */
async function defaultBulkProfile(): Promise<BulkProfile> {
  try {
    const stored = await settingsRepository.get<{ profile?: string }>(SETTINGS_KEYS.engineDefaults);
    const profile = stored?.profile;
    return profile === 'fast' || profile === 'deep' ? profile : 'normal';
  } catch {
    return 'normal';
  }
}

/**
 * Ties the Game Library's selected games to the analysis service: exposes
 * persisted per-game statuses (refreshed on row changes, after runs and
 * polled while a batch is running) plus the batch analyze / cancel actions.
 */
export function useLibraryAnalysis(
  service: AnalysisServiceLike | null,
  gameIds: readonly string[],
): LibraryAnalysisApi {
  const { busy, error, analyze, cancel } = useGameAnalysis(service);
  const [statuses, setStatuses] = useState<Readonly<Record<string, GameAnalysisStatus>>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const activeRef = useRef<{ ids: readonly string[] } | null>(null);

  const key = gameIds.join('\u0000');

  useEffect(() => {
    let cancelled = false;
    void refresh();
    return () => {
      cancelled = true;
    };
    async function refresh(): Promise<void> {
      if (!service || cancelled) {
        return;
      }
      try {
        const next = await service.statusesOf(gameIds);
        if (!cancelled) {
          setStatuses(next);
        }
      } catch {
        // Ignore transient read errors; the Library surface reports its own.
      }
    }
    // Reload whenever the displayed row set changes or after each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, service, busy, running]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      if (service) {
        void service
          .statusesOf(gameIds)
          .then(setStatuses)
          .catch(() => undefined);
      }
    }, 900);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, key, service]);

  useEffect(() => {
    if (!busy && activeRef.current !== null) {
      activeRef.current = null;
      setProgress(null);
    }
  }, [busy]);

  return useMemo<LibraryAnalysisApi>(() => {
    const api: LibraryAnalysisApi = {
      statuses,
      running,
      error,
      progress,
      enabled: service !== null,
      analyze(ids: readonly string[]) {
        activeRef.current = { ids };
        setRunning(true);
        setProgress({ done: 0, total: ids.length });
        const selected = [...ids];
        void (async () => {
          const profile = await defaultBulkProfile();
          await analyze(selected, profile);
        })().finally(() => {
          setRunning(false);
        });
      },
      retry(gameId: string) {
        api.analyze([gameId]);
      },
      cancel() {
        cancel();
      },
    };
    return api;
  }, [statuses, running, error, progress, service, analyze, cancel]);
}
