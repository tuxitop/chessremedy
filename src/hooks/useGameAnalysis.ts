import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisJob } from '@/domain/analysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import type { AnalysisRunOptions } from '@/infrastructure/analysis';

/** UI-facing surface of the game-analysis service (injectable fake in tests). */
export interface AnalysisServiceLike {
  analyzeGames(
    gameIds: readonly string[],
    profile?: 'fast' | 'normal' | 'tactical' | 'deep',
    run?: AnalysisRunOptions,
  ): Promise<readonly AnalysisJob[]>;
  statusesOf(gameIds: readonly string[]): Promise<Readonly<Record<string, GameAnalysisStatus>>>;
  listActiveJobs(): Promise<readonly AnalysisJob[]>;
}

export interface UseGameAnalysis {
  readonly busy: boolean;
  /** User-facing error from a failed run (or `null`). */
  readonly error: string | null;
  /** Analyze/resume/retry the given games under the default profile. */
  analyze(
    gameIds: readonly string[],
    profile?: 'fast' | 'normal' | 'tactical' | 'deep',
  ): Promise<readonly AnalysisJob[]>;
  /** Abort the active batch (queued + in-progress jobs become cancelled). */
  cancel(): void;
}

/**
 * Runs analysis batches to completion (or cancellation), streaming nothing into
 * transient state — progress is read from persisted jobs by the caller.
 * Unmounting while a run is active cancels it (jobs stay resumable).
 */
export function useGameAnalysis(service: AnalysisServiceLike | null): UseGameAnalysis {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const analyze = useCallback(
    async (
      gameIds: readonly string[],
      profile: 'fast' | 'normal' | 'tactical' | 'deep' = 'normal',
    ): Promise<readonly AnalysisJob[]> => {
      controllerRef.current?.abort();
      if (!service) {
        setError('Game analysis is unavailable right now.');
        return [];
      }
      if (gameIds.length === 0) {
        return [];
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      setBusy(true);
      setError(null);
      try {
        const jobs = await service.analyzeGames(gameIds, profile, {
          signal: controller.signal,
        });
        return jobs;
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return [];
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setBusy(false);
      }
    },
    [service],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { busy, error, analyze, cancel };
}
