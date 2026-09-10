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
  /**
   * Freshest engine lines recorded for each analysed FEN this session
   * (progress snapshots and completed results). Enables ephemeral live
   * classification of the moves connecting two analysed positions.
   */
  readonly linesByFen: Readonly<Record<string, readonly EngineLine[]>>;
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

/** Replace/insert one per-rank line into a list (freshest line per rank). */
function upsertLine(lines: readonly EngineLine[], line: EngineLine): readonly EngineLine[] {
  const rank = line.multipv ?? 1;
  return [...lines.filter((l) => (l.multipv ?? 1) !== rank), line].sort(
    (a, b) => (a.multipv ?? 1) - (b.multipv ?? 1),
  );
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
  const [linesByFen, setLinesByFen] = useState<Readonly<Record<string, readonly EngineLine[]>>>({});

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
            // Replace the same-rank line so the display advances each depth,
            // and remember the freshest lines per FEN for live classification.
            const line = progressToLine(event.progress);
            setLiveLines((current) => upsertLine(current, line));
            setLinesByFen((cur) => {
              const merged = upsertLine(cur[job.fen] ?? [], line);
              return merged.length === 0 ? cur : { ...cur, [job.fen]: merged };
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
            if (res.lines.length > 0) {
              setLinesByFen((cur) => ({ ...cur, [res.position]: res.lines }));
            }
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

    // `analyze()` can settle synchronously — e.g. a terminal position with no
    // legal moves fails before `subscribe` runs — and those events are lost.
    // Reconcile from the outcome so the panel never hangs on "Thinking…".
    if (job.status === 'failed') {
      void job.outcome.then((outcome) => {
        if (jobRef.current !== job || outcome.kind !== 'failed') return;
        setError(outcome.error);
        setAnalyzing(false);
        setLiveLines([]);
      });
    } else if (job.status === 'completed') {
      void job.outcome.then((outcome) => {
        if (jobRef.current !== job || outcome.kind !== 'completed') return;
        setResult(outcome.result);
        setAnalyzing(false);
        setLiveLines([]);
      });
    }

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
    linesByFen,
    cancel,
  };
}
