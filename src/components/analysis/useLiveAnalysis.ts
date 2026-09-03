import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineEvaluation,
  EngineJobError,
  EngineLine,
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
  /**
   * Lines to display: the completed result for the current FEN, or the
   * freshest per-rank lines reported as the engine deepens.
   */
  readonly lines: readonly EngineLine[];
  readonly result: EngineAnalysisResult | null;
  readonly error: EngineJobError | null;
  /** Reached depth from live progress or the completed result. */
  readonly reachedDepth: number | null;
  /** Current engine identity, e.g. `stockfish 18.0.8 (lite-single)`. */
  readonly engineLabel: string | null;
  /**
   * Best (first-line) evaluation recorded for each analysed FEN this session
   * (white-perspective magnitude removed; keyed by position FEN). Populated
   * when a result completes, so the move list can show per-ply evaluations.
   */
  readonly evalsByFen: Readonly<Record<string, EngineEvaluation>>;
  /** Abort the active analysis (does not re-run). */
  cancel(): void;
}

function engineLabelOf(status: EngineServiceStatus): string | null {
  if (!status.engine) return null;
  return `${status.engine.engineName} ${status.engine.engineVersion} (${status.engine.engineBuild})`;
}

/** Keep only progress snapshots that carry a real evaluation + a move list. */
function usableLine(progress: EngineProgress): boolean {
  return progress.evaluation !== undefined && (progress.principalVariation?.length ?? 0) > 0;
}

/** Normalise a progress snapshot into a displayable engine line. */
function progressToLine(progress: EngineProgress): EngineLine {
  return {
    multipv: progress.multipv ?? 1,
    evaluation: progress.evaluation!,
    principalVariation: progress.principalVariation ?? [],
    wdl: progress.wdl ?? null,
    ...(progress.depth !== undefined ? { depth: progress.depth } : {}),
    ...(progress.seldepth !== undefined ? { seldepth: progress.seldepth } : {}),
    ...(progress.nodes !== undefined ? { nodes: progress.nodes } : {}),
    ...(progress.timeMs !== undefined ? { timeMs: progress.timeMs } : {}),
  };
}

/**
 * Orchestrates engine jobs for one board position. Whenever the position, the
 * enabled flag or the options change, the in-flight job is cancelled and a new
 * analysis starts for the current FEN. State is driven purely by job events
 * (no synchronous setState inside effects). Live progress lines replace the
 * display as each depth is reached; a completed result supersedes them.
 */
export function useLiveAnalysis({
  service,
  fen,
  enabled,
  options = null,
}: LiveAnalysisOptions): LiveAnalysisState {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<EngineAnalysisResult | null>(null);
  const [liveLines, setLiveLines] = useState<readonly EngineLine[]>([]);
  const [error, setError] = useState<EngineJobError | null>(null);
  const [evalsByFen, setEvalsByFen] = useState<Readonly<Record<string, EngineEvaluation>>>({});

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
            setLiveLines([]);
            setError(null);
          } else if (event.status === 'cancelled') {
            setAnalyzing(false);
            setResult(null);
            setLiveLines([]);
            setError(null);
          } else if (event.status === 'completed' || event.status === 'failed') {
            setAnalyzing(false);
          }
          break;
        case 'progress':
          if (job.fen === fen && usableLine(event.progress)) {
            // Replace the same-rank line so the display advances each depth.
            setLiveLines((current) => {
              const rank = event.progress.multipv ?? 1;
              const rest = current.filter((l) => (l.multipv ?? 1) !== rank);
              return [...rest, progressToLine(event.progress)].sort(
                (a, b) => (a.multipv ?? 1) - (b.multipv ?? 1),
              );
            });
          }
          break;
        case 'result': {
          const res = event.result;
          if (job.fen === fen) {
            setResult(res);
            setLiveLines([]);
            setAnalyzing(false);
            setEvalsByFen((cur) => {
              const best = res.lines[0];
              if (!best) return cur;
              return { ...cur, [res.position]: best.evaluation };
            });
          }
          break;
        }
        case 'error':
          setError(event.error);
          setAnalyzing(false);
          setLiveLines([]);
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

  // Completed results trump live progress for the *current* FEN; otherwise the
  // freshest per-rank lines are shown.
  const currentResult = fen && result?.position === fen ? result : null;
  const lines = currentResult ? currentResult.lines : liveLines;

  const reachedDepth = lines.reduce((max, line) => Math.max(max, line.depth ?? 0), 0) || null;

  return {
    analyzing,
    lines,
    result: currentResult,
    error,
    reachedDepth,
    engineLabel: service ? engineLabelOf(service.getStatus()) : null,
    evalsByFen,
    cancel,
  };
}
