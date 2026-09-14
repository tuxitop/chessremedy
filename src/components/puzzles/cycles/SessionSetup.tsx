import { useState } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/Button';
import { DEFAULT_SESSION_DURATION_MS, SESSION_DURATION_OPTIONS_MS } from '@/domain/training';
import styles from './SessionSetup.module.css';

export interface SessionSetupProps {
  /** The preselected duration (the Default session length setting). */
  readonly defaultDurationMs: number;
  /** Begin the session with the chosen duration; `null` means "No time limit". */
  readonly onBegin: (durationMs: number | null) => void;
  readonly onCancel?: () => void;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** Panel heading; defaults to the Feature-019 "Session length". */
  readonly title?: string;
  /** Intro copy; defaults to the Feature-019 text. */
  readonly description?: string;
  /** Optional extra content (counts, cap links) shown above the duration choice. */
  readonly details?: React.ReactNode;
  /** Begin-button label; defaults to "Begin". */
  readonly beginLabel?: string;
}

/**
 * The pre-session commit gate (Feature 019 §1): a labelled duration chooser with
 * the Default session length preselected, a "No time limit" option, and a single
 * Begin control that starts the timer. Nothing counts down before Begin.
 *
 * Feature 020 reuses it for the review session by supplying `title`/
 * `description`/`details`/`beginLabel`; every new prop is optional and its
 * default preserves the Feature-019 behaviour exactly.
 */
export function SessionSetup({
  defaultDurationMs,
  onBegin,
  onCancel,
  disabled = false,
  testId = 'session-setup',
  title = 'Session length',
  description = 'Commit to a focused session — the timer keeps you on pace. The cycle stays resumable.',
  details,
  beginLabel = 'Begin',
}: SessionSetupProps): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(() =>
    SESSION_DURATION_OPTIONS_MS.includes(defaultDurationMs)
      ? defaultDurationMs
      : DEFAULT_SESSION_DURATION_MS,
  );
  const titleId = `${testId}-title`;

  return (
    <section className={styles.panel} data-testid={testId} aria-labelledby={titleId}>
      <h2 className={styles.title} id={titleId}>
        {title}
      </h2>
      <p className={styles.text}>{description}</p>
      {details !== undefined ? <div data-testid={`${testId}-details`}>{details}</div> : null}
      <div className={styles.options} role="radiogroup" aria-labelledby={titleId}>
        {SESSION_DURATION_OPTIONS_MS.map((durationMs) => {
          const minutes = Math.round(durationMs / 60_000);
          const isActive = selected === durationMs;
          return (
            <button
              key={durationMs}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={[styles.chip, isActive ? styles.active : ''].filter(Boolean).join(' ')}
              disabled={disabled}
              onClick={() => setSelected(durationMs)}
              data-testid={`session-duration-${minutes}`}
            >
              {minutes} min
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={selected === null}
          className={[styles.chip, selected === null ? styles.active : '']
            .filter(Boolean)
            .join(' ')}
          disabled={disabled}
          onClick={() => setSelected(null)}
          data-testid="session-duration-none"
        >
          No time limit
        </button>
      </div>
      <div className={styles.actions}>
        <Button data-testid="session-begin" disabled={disabled} onClick={() => onBegin(selected)}>
          {beginLabel}
        </Button>
        {onCancel ? (
          <Button
            variant="secondary"
            data-testid={`${testId}-cancel`}
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </section>
  );
}
