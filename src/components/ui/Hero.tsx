import type * as React from 'react';
import styles from './Hero.module.css';

export interface HeroAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface HeroProps {
  title: string;
  tagline: string;
  actions?: HeroAction[];
}

export function Hero({ title, tagline, actions }: HeroProps): React.JSX.Element {
  return (
    <section className={styles.hero} data-testid="hero">
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.tagline}>{tagline}</p>
      {actions && actions.length > 0 && (
        <div className={styles.actions}>
          {actions.map((action) =>
            action.href !== undefined ? (
              <a
                key={action.label}
                href={action.href}
                className={styles.actions}
                data-action-label={action.label}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                data-action-label={action.label}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
    </section>
  );
}
