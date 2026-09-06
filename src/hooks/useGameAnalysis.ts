import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisJob, ExpectedAnalysisConfig, GameAnalysisConfig } from '@/domain/analysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import type { AnalysisProfile } from '@/domain/chess';
import type { AnalysisRunOptions, GameAnalysisProgress } from '@/infrastructure/analysis';

/** UI-facing surface of the game-analysis service (injectable fake in tests). */
export interface AnalysisServiceLike {
  analyzeGames(
    gameIds: readonly string[],
    profile?: AnalysisProfile,
    run?: AnalysisRunOptions,
  ): Promise<readonly AnalysisJob[]>;
  statusesOf(
    gameIds: readonly string[],
    expected?: ExpectedAnalysisConfig,
  ): Promise<Readonly<Record<string, GameAnalysisStatus>>>;
  listActiveJobs(): Promise<readonly AnalysisJob[]>;
  /** Optional live per-game progress (queued/in-progress positions). */
  jobProgress?(
    gameIds: readonly string[],
  ): Promise<Readonly<Record<string, GameAnalysisProgress | undefined>>>;
  /** Cancel one game's queued/in-progress job; the rest of a batch continues. */
  cancelGame(gameId: string): Promise<void>;
  /**
   * Feature-010 lazy backfill: derive + persist per-analysis summaries for
   * games whose latest completed analysis has none yet (older runs gain
   * Library insights without re-analysis). Optional — tests/fakes may omit it.
   */
  ensureSummariesForRows?(gameIds: readonly string[]): Promise<number>;
}

export interface UseGameAnalysis {
  readonly busy: boolean;
  /** User-facing error from a failed run (or `null`). */
  readonly error: string | null;
  /** Analyze/resume/retry the given games under a profile + optional overrides. */
  analyze(
    gameIds: readonly string[],
    profile?: AnalysisProfile,
    force?: boolean,
    config?: GameAnalysisConfig,
  ): Promise<readonly AnalysisJob[]>;
  /** Abort the active run(s); queued requests become cancelled in turn. */
  cancel(): void;
}

/**
 * Runs analysis batches to completion (or cancellation), streaming nothing into
 * transient state — progress is read from persisted jobs by the caller.
 *
 * The service serializes batches (Feature 008 §5), so a new `analyze` while one
 * is running is queued behind it and never aborts the active run. All `analyze`
 * calls issued from this hook share a single AbortController so `cancel` stops
 * the running batch and the queued requests behind it; unmounting aborts too
 * (jobs stay resumable).
 */
export function useGameAnalysis(service: AnalysisServiceLike | null): UseGameAnalysis {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(0);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const analyze = useCallback(
    async (
      gameIds: readonly string[],
      profile: AnalysisProfile = 'normal',
      force = false,
      config?: GameAnalysisConfig,
    ): Promise<readonly AnalysisJob[]> => {
      if (!service) {
        setError('Game analysis is unavailable right now.');
        return [];
      }
      if (gameIds.length === 0) {
        return [];
      }
      // A new analyze queues behind the active run (service-level serialization)
      // — it must not abort it. Start a fresh controller only when the previous
      // session was explicitly cancelled (so a post-cancel analyze is not
      // instantly aborted by the stale signal).
      let controller = controllerRef.current;
      if (!controller || controller.signal.aborted) {
        controller = new AbortController();
        controllerRef.current = controller;
      }
      inFlightRef.current += 1;
      setBusy(true);
      setError(null);
      try {
        const jobs = await service.analyzeGames([...gameIds], profile, {
          signal: controller.signal,
          ...(force ? { force: true } : {}),
          ...(config !== undefined ? { config } : {}),
        });
        return jobs;
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return [];
      } finally {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) {
          controllerRef.current = null;
          setBusy(false);
        }
      }
    },
    [service],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { busy, error, analyze, cancel };
}
