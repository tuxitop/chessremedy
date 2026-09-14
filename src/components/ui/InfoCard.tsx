import type * as React from 'react';
import { Link } from 'react-router-dom';
import styles from './InfoCard.module.css';

/** One label/value pair rendered in the card's info grid. */
export interface InfoCardRow {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly testId?: string;
}

/** A status pill shown beside the card title. */
export interface InfoCardPill {
  readonly label: string;
  readonly muted?: boolean;
  readonly testId?: string;
}

/** The card's single accent call-to-action. */
export interface InfoCardAction {
  readonly label: string;
  readonly to: string;
  readonly testId?: string;
  readonly disabled?: boolean;
  /** Optional explanation rendered after the button. */
  readonly note?: React.ReactNode;
  readonly noteTestId?: string;
}

export interface InfoCardProps {
  /** Uppercase section title. */
  readonly title: string;
  /** Id for the title heading; also names the section. */
  readonly titleId?: string;
  readonly pill?: InfoCardPill | null;
  /** One line of muted supporting text. */
  readonly description?: React.ReactNode;
  readonly descriptionTestId?: string;
  /** Extra content between the description and the info grid. */
  readonly children?: React.ReactNode;
  readonly rows?: readonly InfoCardRow[];
  readonly rowsTestId?: string;
  readonly action?: InfoCardAction | null;
  readonly testId?: string;
  readonly role?: React.AriaRole;
  readonly ariaLabel?: string;
}

/**
 * The shared Home/Training action card: an uppercase title (+ optional pill),
 * a muted description, an info grid of label/value rows and one accent action
 * button. It gives the Review, Resume-cycle and Continue-training entries the
 * same structure and look.
 */
export function InfoCard({
  title,
  titleId,
  pill = null,
  description,
  descriptionTestId,
  children,
  rows,
  rowsTestId,
  action = null,
  testId,
  role,
  ariaLabel,
}: InfoCardProps): React.JSX.Element {
  return (
    <section
      className={styles.card}
      data-testid={testId}
      role={role}
      aria-label={titleId === undefined ? ariaLabel : undefined}
      aria-labelledby={titleId}
    >
      <div className={styles.header}>
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        {pill !== null ? (
          <span
            className={[styles.pill, pill.muted === true ? styles.pillMuted : '']
              .filter(Boolean)
              .join(' ')}
            data-testid={pill.testId}
          >
            {pill.label}
          </span>
        ) : null}
      </div>

      {description !== undefined ? (
        <p className={styles.text} data-testid={descriptionTestId}>
          {description}
        </p>
      ) : null}
      {children}

      {rows !== undefined && rows.length > 0 ? (
        <dl className={styles.grid} data-testid={rowsTestId}>
          {rows.map((row) => (
            <div key={row.label} className={styles.row}>
              <dt className={styles.label}>{row.label}</dt>
              <dd className={styles.value} data-testid={row.testId}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {action !== null ? (
        <div className={styles.actions}>
          <Link
            className={[styles.button, action.disabled === true ? styles.buttonDisabled : '']
              .filter(Boolean)
              .join(' ')}
            to={action.to}
            data-testid={action.testId}
            aria-disabled={action.disabled === true}
            tabIndex={action.disabled === true ? -1 : undefined}
            onClick={(event) => {
              if (action.disabled === true) {
                event.preventDefault();
              }
            }}
          >
            {action.label}
          </Link>
          {action.note !== undefined ? (
            <span className={styles.note} data-testid={action.noteTestId}>
              {action.note}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
