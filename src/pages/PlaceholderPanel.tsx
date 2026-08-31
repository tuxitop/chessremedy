import type * as React from 'react';
import styles from './PlaceholderPanel.module.css';

export interface PlaceholderPanelProps {
  heading: string;
  description: string;
  /** Badge text shown above the heading, e.g. "Coming in Feature 007". */
  badge: string;
}

/**
 * Shared layout for pages that are reserved for a future feature. Renders
 * a heading, a description and a visible "Coming in Feature XXX" badge so
 * the page is self-documenting and does not look like a forgotten page.
 */
export function PlaceholderPanel({
  heading,
  description,
  badge,
}: PlaceholderPanelProps): React.JSX.Element {
  return (
    <section className={styles.panel} data-testid="placeholder-panel">
      <span className={styles.badge} data-testid="placeholder-badge">
        {badge}
      </span>
      <h1 className={styles.heading}>{heading}</h1>
      <p className={styles.description}>{description}</p>
    </section>
  );
}
