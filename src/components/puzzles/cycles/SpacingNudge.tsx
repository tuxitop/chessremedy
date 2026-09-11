import type * as React from 'react';
import { Button } from '@/components/ui/Button';
import styles from './SpacingNudge.module.css';

export interface SpacingNudgeProps {
  /** The block being trained. */
  readonly setName: string;
  /** The previous cycle of the same block. */
  readonly previousCycleNumber: number;
  /** Proceed into the session despite the short gap (never blocked). */
  readonly onStartAnyway: () => void;
  readonly testId?: string;
}

/**
 * The non-blocking spacing nudge (spec §4/§18): shown before a block cycle when
 * the previous cycle of the same block ended on the same local calendar day. It
 * recommends training the block on different days and offers a clear "Start
 * anyway" control; it never blocks the session and is announced politely.
 */
export function SpacingNudge({
  setName,
  previousCycleNumber,
  onStartAnyway,
  testId = 'cycle-spacing-nudge',
}: SpacingNudgeProps): React.JSX.Element {
  return (
    <section className={styles.panel} data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 className={styles.title} id={`${testId}-title`}>
        Spacing guidance
      </h2>
      <p className={styles.text} role="status" aria-live="polite" data-testid={`${testId}-text`}>
        You already trained “{setName}” in cycle {previousCycleNumber} today. Spacing cycles across
        different days is recommended for this method. This is guidance, not a rule — you can start
        now.
      </p>
      <div className={styles.actions}>
        <Button data-testid={`${testId}-start`} onClick={onStartAnyway}>
          Start anyway
        </Button>
      </div>
    </section>
  );
}
