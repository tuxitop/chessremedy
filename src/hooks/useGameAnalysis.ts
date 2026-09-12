import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisJob, ExpectedAnalysisConfig, GameAnalysisConfig } from '@/domain/analysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import type { AnalysisProfile } from '@/domain/chess';
import type {
  AnalysisRunOptions,
  GameAnalysisProgress,
  PuzzleGenerationOutcome,
  ReconcileResult,
  ScanGameOutcome,
} from '@/infrastructure/analysis';

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
  /**
   * Game ids whose Feature-010 detection pass is running right now in this
   * session. A persisted `queued`/`inProgress` summary whose game id is not
   * returned here is an *interrupted* pass (from an earlier session), not a
   * live scan — the UI must not say "scanning" for it. Optional: when absent
   * the UI treats no scan as live.
   */
  activeDetectionGames?(): Promise<readonly string[]>;
  /**
   * Game ids whose analysis job is running right now in this session. A
   * persisted `queued`/`inProgress` job whose game id is absent is *paused*
   * (left by an earlier session) — it is never auto-run and never reads as
   * live. Optional: when absent the UI treats no analysis as live.
   */
  liveAnalysisGames?(): Promise<readonly string[]>;
  /**
   * Run only the Feature-010 tactics scan for a game's latest completed
   * analysis (no re-analysis). `options.force` is the explicit re-scan path
   * (e.g. the verification depth changed) and bypasses the completed/current
   * no-op. Optional — tests/fakes may omit it.
   */
  scanGame?(gameId: string, options?: { readonly force?: boolean }): Promise<ScanGameOutcome>;
  /** Cancel a game's live tactics scan. Optional — fakes may omit it. */
  cancelScan?(gameId: string): Promise<void>;
  /**
   * Game ids whose Feature-011 puzzle-generation pass is running right now in
   * this session. A persisted `queued`/`inProgress` puzzle summary whose game
   * id is not returned here is an *interrupted* pass (from an earlier
   * session), not a live generation — the UI must not say "generating" for
   * it. Optional: when absent the UI treats no generation as live.
   */
  activeGenerationGames?(): Promise<ReadonlySet<string>>;
  /**
   * Generate/resume/retry the Feature-011 puzzle-generation pass for a game's
   * latest completed analysis whose detection pass has completed at the
   * current version (engine-free — pure assembly + batched writes). Mirrors
   * `scanGame`. Optional — fakes may omit it.
   */
  generatePuzzles?(gameId: string): Promise<PuzzleGenerationOutcome>;
  /** Cancel a game's live puzzle-generation pass. Optional — fakes may omit it. */
  cancelGeneration?(gameId: string): Promise<void>;
  /**
   * Reconcile orphaned work once per session (pause owner-less in-progress
   * detection summaries; analysis orphans are left paused, never auto-run).
   * Optional — fakes may omit it.
   */
  reconcileOrphans?(): Promise<ReconcileResult>;
  /**
   * Remove every owner-less `queued`/`inProgress` analysis job and its
   * incomplete derived rows (Settings "Analysis maintenance"). Games and
   * completed analyses are untouched. Optional — fakes may omit it.
   */
  clearPausedAnalysisJobs?(): Promise<number>;
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
