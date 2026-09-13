import type * as React from 'react';
import { formatSolveTime } from '@/components/puzzles/solve/solveText';
import styles from './SessionTimer.module.css';

export interface SessionTimerProps {
  /** Time until the session ends; `null` when the session is untimed. */
  readonly remainingMs: number | null;
  /** True when remaining time is at or below the warning threshold. */
  readonly warning: boolean;
  /** True once the session has reached zero. */
  readonly expired?: boolean;
  readonly testId?: string;
}

/**
 * The quiet session countdown (Feature 019 §2): a small `mm:ss` readout plus a
 * thin progress bar. It is never colour-only — the text and `aria-label` carry
 * the state, and the red warning/expiry state is a secondary signal. Untimed
 * sessions render nothing. Threshold announcements are the parent's job
 * (`aria-live` is off here).
 */
export function SessionTimer({
  remainingMs,
  warning,
  expired = false,
  testId = 'session-timer',
}: SessionTimerProps): React.JSX.Element | null {
  if (remainingMs === null) {
    return null;
  }

  const state = expired ? 'expired' : warning ? 'warning' : 'normal';
  const readout = formatSolveTime(remainingMs);
  const stateSuffix = state === 'expired' ? ' — expired' : state === 'warning' ? ' — warning' : '';
  const stateClass = state === 'normal' ? undefined : styles[state];
  const withinMinute = remainingMs % 60_000;
  const progress = remainingMs === 0 ? 0 : (withinMinute === 0 ? 60_000 : withinMinute) / 60_000;

  return (
    <section
      className={[styles.timer, stateClass].filter(Boolean).join(' ')}
      data-testid={testId}
      data-state={state}
      role="timer"
      aria-live="off"
      aria-label={`Time remaining: ${readout}${stateSuffix}`}
    >
      <span className={styles.readout} data-testid={`${testId}-readout`}>
        {readout}
      </span>
      <span className={styles.caption} aria-hidden="true">
        time remaining
      </span>
      <div className={styles.track} aria-hidden="true">
        <div
          className={styles.bar}
          data-testid={`${testId}-bar`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </section>
  );
}
