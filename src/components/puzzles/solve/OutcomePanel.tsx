import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import type { HintLevel, TrainingResult } from '@/domain/training';
import type { WritePhase } from '@/hooks/usePuzzleSolve';
import { Button } from '@/components/ui/Button';
import { formatSolveTime, resultLabel } from './solveText';
import styles from './OutcomePanel.module.css';

export interface OutcomePanelProps {
  readonly result: TrainingResult;
  readonly solvingTimeMs: number;
  readonly wrongMoveCount: number;
  readonly hintCount: number;
  readonly highestHintLevel: HintLevel | null;
  /** Write state of the outcome row (`pending`/`written`/`retryable`). */
  readonly writePhase: WritePhase;
  /** Inline write-error text while `writePhase === 'retryable'`. */
  readonly writeError: string | null;
  /** True when the post-solve step may be opened (analyze). */
  readonly canAnalyze: boolean;
  /** Retry the failed attempt write. */
  readonly onRetryWrite: () => void;
  /** Discard the outcome (leave with the row unwritten); only when retryable. */
  readonly onDiscard: () => void;
  /** Open the engine-free post-solve step (analyze). */
  readonly onAnalyze: () => void;
  /** Close the outcome screen and return to the host. */
  readonly onContinue: () => void;
}

/** Highest-hint-level display text (`null` = no hint used). */
export function highestHintText(level: HintLevel | null): string {
  return level === null ? 'None' : `Level ${level}`;
}

/**
 * Outcome summary panel shown at a definite presentation outcome (spec
 * Outcomes): result, solving time, wrong-move count and hints used. The row
 * write is surfaced inline — a pending write is noted, a failed write shows an
 * inline error with Retry and an explicit confirm-discard affordance, and
 * Continue never advances the session past an unwritten row. The result is
 * announced via an `aria-live` region and focus moves to the panel.
 */
export function OutcomePanel(props: OutcomePanelProps): React.JSX.Element {
  const {
    result,
    solvingTimeMs,
    wrongMoveCount,
    hintCount,
    highestHintLevel,
    writePhase,
    writeError,
    canAnalyze,
    onRetryWrite,
    onDiscard,
    onAnalyze,
    onContinue,
  } = props;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const written = writePhase === 'written';
  const retryable = writePhase === 'retryable';
  const locked = !written;

  const summary = `${resultLabel(result)} in ${formatSolveTime(solvingTimeMs)}.`;

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className={styles.panel}
      aria-label="Puzzle outcome"
      data-testid="outcome-panel"
    >
      <p className={styles.live} role="status" data-testid="outcome-announcement">
        {summary}
      </p>
      <h2 className={styles.heading} data-testid="outcome-result">
        {resultLabel(result)}
      </h2>
      <dl className={styles.facts}>
        <div className={styles.factRow}>
          <dt>Time</dt>
          <dd data-testid="outcome-time">{formatSolveTime(solvingTimeMs)}</dd>
        </div>
        <div className={styles.factRow}>
          <dt>Wrong moves</dt>
          <dd data-testid="outcome-wrong-moves">{wrongMoveCount}</dd>
        </div>
        <div className={styles.factRow}>
          <dt>Hints used</dt>
          <dd data-testid="outcome-hints">
            {hintCount} · highest {highestHintText(highestHintLevel)}
          </dd>
        </div>
      </dl>

      {writePhase === 'pending' ? (
        <p className={styles.note} role="status" data-testid="outcome-write-pending">
          Recording this attempt…
        </p>
      ) : null}

      {retryable ? (
        <div className={styles.errorBox} role="alert" data-testid="outcome-write-error">
          <p className={styles.errorText}>{writeError ?? 'The attempt could not be recorded.'}</p>
          <p className={styles.errorNote}>
            The outcome stays visible. Retry the write, or leave without recording it.
          </p>
          {!confirmDiscard ? (
            <div className={styles.actions}>
              <Button variant="primary" onClick={onRetryWrite} data-testid="outcome-retry-write">
                Retry
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmDiscard(true)}
                data-testid="outcome-confirm-discard-start"
              >
                Leave without recording
              </Button>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                className={styles.dangerButton!}
                onClick={onDiscard}
                data-testid="outcome-discard"
              >
                Discard this outcome
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmDiscard(false)}
                data-testid="outcome-keep"
              >
                Keep the outcome
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <div className={styles.actions}>
        {canAnalyze && written ? (
          <Button variant="secondary" onClick={onAnalyze} data-testid="outcome-analyze">
            Analyze
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={locked}
          onClick={onContinue}
          data-testid="outcome-continue"
        >
          Continue
        </Button>
      </div>
    </section>
  );
}
