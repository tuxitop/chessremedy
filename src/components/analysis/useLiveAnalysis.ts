import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineJobError,
  EngineProgress,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';

/**
 * Minimal engine surface the live-analysis hook needs. `EngineService`
 * (and the Feature 006 session-cache decorator) satisfy this, so tests can
 * inject a lightweight fake.
 */
export interface LiveEngineService {
  analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob;
  cancel(jobId: string): void;
  getStatus(): EngineServiceStatus;
  onStatusChange(listener: (status: EngineServiceStatus) => void): () => void;
}

export interface LiveAnalysisOptions {
  readonly service: LiveEngineService | null;
  /** Board FEN to analyse (null → idle). */
  readonly fen: string | null;
  /** Master switch: off cancels the active job. */
  readonly enabled: boolean;
  /** Resolved engine options (profile + overrides). */
  readonly options?: Partial<AnalysisOptions> | null;
}

export interface LiveAnalysisState {
  readonly analyzing: boolean;
  /** The completed result for the *current* FEN, or null. */
  readonly result: EngineAnalysisResult | null;
  readonly progress: EngineProgress | null;
  readonly error: EngineJobError | null;
  /** Reached depth from progress or the completed result. */
  readonly reachedDepth: number | null;
  /** Current engine identity, e.g. `stockfish 18.0.8 (lite-single)`. */
  readonly engineLabel: string | null;
  /** Abort the active analysis (does not re-run). */
  cancel(): void;
}

function engineLabelOf(status: EngineServiceStatus): string | null {
  if (!status.engine) return null;
  return `${status.engine.engineName} ${status.engine.engineVersion} (${status.engine.engineBuild})`;
}

/**
 * Orchestrates engine jobs for one board position. Whenever the position, the
 * enabled flag or the options change, the in-flight job is cancelled and a new
 * analysis starts for the current FEN. State is driven purely by job events
 * (no synchronous setState inside effects), and the job for a stale position
 * is unsubscribed before it is cancelled, so late events cannot surface.
 */
export function useLiveAnalysis({
  service,
  fen,
  enabled,
  options = null,
}: LiveAnalysisOptions): LiveAnalysisState {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<EngineAnalysisResult | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [error, setError] = useState<EngineJobError | null>(null);

  const jobRef = useRef<AnalysisJob | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    const job = jobRef.current;
    jobRef.current = null;
    if (job && (job.status === 'queued' || job.status === 'running')) {
      service?.cancel(job.id);
    }
  }, [service]);

  // Run (or stop) the analysis for the current position.
  useEffect(() => {
    if (!enabled || !service || !fen) {
      teardown();
      return undefined;
    }

    teardown();
    const job = service.analyze(fen, options ?? undefined);
    jobRef.current = job;

    const unsubscribe = job.subscribe((event: AnalysisJobEvent) => {
      if (jobRef.current !== job) return;
      switch (event.type) {
        case 'status':
          if (event.status === 'running') {
            setAnalyzing(true);
            setProgress(null);
            setResult(null);
            setError(null);
          } else if (event.status === 'cancelled') {
            setAnalyzing(false);
            setProgress(null);
            setResult(null);
            setError(null);
          } else if (event.status === 'completed' || event.status === 'failed') {
            setAnalyzing(false);
          }
          break;
        case 'progress':
          if (job.fen === fen) {
            setProgress(event.progress);
          }
          break;
        case 'result': {
          const res = event.result;
          if (job.fen === fen) {
            setResult(res);
            setAnalyzing(false);
            setProgress(null);
          }
          break;
        }
        case 'error':
          setError(event.error);
          setAnalyzing(false);
          setProgress(null);
          break;
      }
    });
    unsubscribeRef.current = unsubscribe;
    return () => {
      unsubscribe();
      teardown();
    };
  }, [service, fen, enabled, options, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  const cancel = useCallback(() => {
    jobRef.current?.cancel();
  }, []);

  // Only a result matching the currently displayed position is ever shown.
  const currentResult = fen && result?.position === fen ? result : null;
  const reachedDepth =
    (analyzing ? (progress?.depth ?? null) : null) ??
    (currentResult && currentResult.lines.length > 0
      ? (currentResult.lines[0]!.depth ?? null)
      : null) ??
    null;

  return {
    analyzing,
    result: currentResult,
    progress,
    error,
    reachedDepth,
    engineLabel: service ? engineLabelOf(service.getStatus()) : null,
    cancel,
  };
}
