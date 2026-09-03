import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisProfile } from '@/domain/chess';
import { uciPvToSan } from '@/domain/chess';
import { ANALYSIS_PROFILE_ORDER } from '@/infrastructure/engine/engineProfiles';
import type {
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisOptions,
  EngineEvaluation,
  EngineJobError,
  EngineLine,
  EngineLifecycleState,
  EngineProgress,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';
import styles from './EnginePanel.module.css';

/**
 * Minimal engine surface the panel needs. `EngineService` satisfies this, so
 * tests can inject a lightweight fake.
 */
export interface EnginePanelService {
  analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob;
  cancel(jobId: string): void;
  getStatus(): EngineServiceStatus;
  onStatusChange(listener: (status: EngineServiceStatus) => void): () => void;
}

export interface EnginePanelProps {
  readonly service: EnginePanelService | null;
  /** FEN of the current board position to analyze. */
  readonly fen: string | null;
}

const LIFECYCLE_LABELS: Record<EngineLifecycleState, string> = {
  uninitialized: 'Idle',
  initializing: 'Starting engine…',
  ready: 'Ready',
  busy: 'Analyzing…',
  failed: 'Engine failed',
  disposed: 'Stopped',
};

/** `+0.72`, `-1.34`, `M3`, `-M5` — mate is never rendered as centipawns. */
export function formatEvaluation(evaluation: EngineEvaluation): string {
  if ('mate' in evaluation) {
    return evaluation.mate > 0 ? `M${evaluation.mate}` : `-M${Math.abs(evaluation.mate)}`;
  }
  const cp = evaluation.cp;
  const sign = cp > 0 ? '+' : cp < 0 ? '-' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

/** `1234` → `1.2k`, `1400000` → `1.4M`. */
export function formatNodes(nodes: number): string {
  if (nodes >= 1_000_000) {
    return `${(nodes / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (nodes >= 1_000) {
    return `${(nodes / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(nodes);
}

/** `2100` → `2.1s`. */
export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fenMoveContext(fen: string): { fullmove: number; whiteToMove: boolean } {
  const parts = fen.split(/\s+/);
  const fullmove = Number.parseInt(parts[5] ?? '', 10);
  return {
    fullmove: Number.isFinite(fullmove) ? fullmove : 1,
    whiteToMove: parts[1] !== 'b',
  };
}

/** Number a SAN move list with PGN-style move numbers from the FEN. */
export function numberSans(fen: string, sans: readonly string[]): string {
  const { fullmove, whiteToMove } = fenMoveContext(fen);
  const out: string[] = [];
  for (let i = 0; i < sans.length; i += 1) {
    const san = sans[i]!;
    const isWhiteMove = whiteToMove ? i % 2 === 0 : i % 2 === 1;
    const pair = Math.floor(i / 2);
    if (isWhiteMove) {
      const moveNumber = fullmove + (whiteToMove ? pair : pair + 1);
      out.push(`${moveNumber}.`);
    } else if (i === 0) {
      // The line starts with a Black move: `3... exd4`.
      out.push(`${fullmove}...`);
    }
    out.push(san);
  }
  return out.join(' ');
}

/**
 * Render an engine PV as numbered SAN when possible, falling back to raw UCI
 * tokens (e.g. `3. d4 exd4 4. Nxd5 …`).
 */
export function formatPv(fen: string, uciMoves: readonly { readonly uci: string }[]): string {
  if (uciMoves.length === 0) return '';
  const tokens = uciMoves.map((m) => m.uci);
  const converted = uciPvToSan(fen, tokens);
  if (!converted.ok) return tokens.join(' ');
  return numberSans(fen, converted.sans);
}

export function EnginePanel({ service, fen }: EnginePanelProps): React.JSX.Element {
  const [profile, setProfile] = useState<AnalysisProfile>('fast');
  const [lifecycle, setLifecycle] = useState<EngineLifecycleState>(
    () => service?.getStatus().lifecycle ?? 'uninitialized',
  );
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [result, setResult] = useState<{
    fen: string;
    lines: readonly EngineLine[];
    timeMs: number;
  } | null>(null);
  const [error, setError] = useState<EngineJobError | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (!service) return;
    const sync = (status: EngineServiceStatus): void => {
      setLifecycle(status.lifecycle);
      setEngineVersion(
        status.engine ? `${status.engine.engineVersion} (${status.engine.engineBuild})` : null,
      );
    };
    sync(service.getStatus());
    return service.onStatusChange(sync);
  }, [service]);

  const handleStart = useCallback(() => {
    if (!service || !fen || activeJobId) return;
    setProgress(null);
    setResult(null);
    setError(null);
    setCancelled(false);
    const job = service.analyze(fen, { profile });
    setActiveJobId(job.id);
    const unsubscribe = job.subscribe((event: AnalysisJobEvent) => {
      switch (event.type) {
        case 'progress':
          setProgress(event.progress);
          break;
        case 'result':
          setResult({
            fen: event.result.position,
            lines: event.result.lines,
            timeMs: event.result.timeMs,
          });
          setProgress(null);
          setActiveJobId(null);
          break;
        case 'error':
          setError(event.error);
          setProgress(null);
          setActiveJobId(null);
          break;
        case 'status':
          if (event.status === 'cancelled') {
            setCancelled(true);
            setProgress(null);
            setActiveJobId(null);
          }
          break;
      }
    });
    // Clear the active id if the job settles without another event (defensive).
    void job.outcome.finally(() => {
      unsubscribe();
      setActiveJobId((current) => (current === job.id ? null : current));
    });
  }, [service, fen, profile, activeJobId]);

  const handleStop = useCallback(() => {
    if (service && activeJobId) {
      service.cancel(activeJobId);
    }
  }, [service, activeJobId]);

  const busy = activeJobId !== null;
  const disabled = !service || !fen;
  const statusLabel = busy ? 'Analyzing…' : LIFECYCLE_LABELS[lifecycle];
  const hasResultLines = result !== null && result.lines.length > 0;

  const engineMeta = useMemo(
    () =>
      engineVersion
        ? `${service?.getStatus().engine?.engineName ?? 'stockfish'} ${engineVersion}`
        : null,
    [engineVersion, service],
  );

  return (
    <section className={styles.panel} data-testid="engine-panel" aria-label="Engine analysis">
      <div className={styles.header}>
        <span className={styles.title}>Engine</span>
        <span className={styles.status} data-testid="engine-status">
          {statusLabel}
        </span>
      </div>

      {engineMeta && (
        <div className={styles.meta} data-testid="engine-meta">
          {engineMeta}
        </div>
      )}

      <div className={styles.controls}>
        <label className={styles.profileLabel}>
          <span className={styles.profileLabelText}>Profile</span>
          <select
            className={styles.profileSelect}
            data-testid="engine-profile"
            value={profile}
            disabled={busy || disabled}
            onChange={(e) => setProfile(e.target.value as AnalysisProfile)}
          >
            {ANALYSIS_PROFILE_ORDER.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {busy ? (
          <button
            type="button"
            className={styles.button}
            onClick={handleStop}
            data-testid="engine-stop"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            onClick={handleStart}
            disabled={disabled}
            data-testid="engine-start"
          >
            Start
          </button>
        )}
      </div>

      {busy && progress && (
        <div className={styles.progress} data-testid="engine-progress">
          <ProgressLine fen={fen ?? ''} progress={progress} />
        </div>
      )}

      {cancelled && !busy && (
        <p className={styles.cancelled} data-testid="engine-cancelled">
          Analysis stopped.
        </p>
      )}

      {hasResultLines && !busy && (
        <div className={styles.lines} data-testid="engine-result">
          {result!.lines.map((line) => (
            <EngineLineRow key={`${result!.fen}|${line.multipv}`} fen={result!.fen} line={line} />
          ))}
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert" data-testid="engine-error">
          <strong>Engine error.</strong> {error.message}
        </div>
      )}
    </section>
  );
}

function ProgressLine({
  fen,
  progress,
}: {
  readonly fen: string;
  readonly progress: EngineProgress;
}): React.JSX.Element {
  const bits: string[] = [];
  if (progress.depth !== undefined) bits.push(`Depth: ${progress.depth}`);
  if (progress.nodes !== undefined) bits.push(`Nodes: ${formatNodes(progress.nodes)}`);
  if (progress.timeMs !== undefined) bits.push(`Time: ${formatTime(progress.timeMs)}`);
  if (progress.evaluation) bits.push(`Eval: ${formatEvaluation(progress.evaluation)}`);
  if (progress.principalVariation && progress.principalVariation.length > 0) {
    bits.push(`PV: ${formatPv(fen, progress.principalVariation)}`);
  }
  if (bits.length === 0) {
    return <span>Thinking…</span>;
  }
  return <span className={styles.progressText}>{bits.join(' · ')}</span>;
}

/**
 * One engine line: `[evaluation] numbered movelist`. Lines are plain (not a
 * numbered list) and carry PGN move numbers (Q7). The movelist always renders
 * in full; when it is too long to fit the line it is clipped to the line end
 * and a trailing `▾` control appears at the far right to wrap it onto more
 * lines (Q9 revisited).
 */
function EngineLineRow({
  fen,
  line,
}: {
  readonly fen: string;
  readonly line: EngineLine;
}): React.JSX.Element {
  const pvRef = useRef<HTMLSpanElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const allMoves = line.principalVariation;
  const pvText = formatPv(fen, allMoves);

  useEffect(() => {
    const element = pvRef.current;
    if (!element || expanded) return;
    const measure = (): void => {
      setOverflows(element.scrollWidth > element.clientWidth + 1);
    };
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    return () => observer?.disconnect();
  }, [expanded, pvText]);

  const showControl = overflows || expanded;
  return (
    <div className={styles.line}>
      <span className={styles.lineEval} data-testid="engine-eval">
        {formatEvaluation(line.evaluation)}
      </span>
      <span
        ref={pvRef}
        className={expanded ? `${styles.linePv} ${styles.linePvExpanded}` : styles.linePv}
        data-testid="engine-pv"
      >
        {pvText}
      </span>
      {showControl && (
        <button
          type="button"
          className={styles.expandButton}
          data-testid="engine-line-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? 'Show fewer moves' : 'Show more moves'}
          title={expanded ? 'Show fewer moves' : 'Show more moves'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '\u25b4' : '\u25be'}
        </button>
      )}
    </div>
  );
}
