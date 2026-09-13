import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { ANALYSIS_GLYPH, PUZZLES_GLYPH } from '@/components/ui/icons';
import styles from './HomeQuickNav.module.css';

interface QuickLink {
  readonly to: string;
  readonly label: string;
  readonly description: string;
  readonly glyph: string;
}

const QUICK_LINKS: readonly QuickLink[] = [
  {
    to: ROUTES.games,
    label: 'Games',
    description: 'Import and review your games.',
    glyph: '\u265F',
  },
  {
    to: ROUTES.training,
    label: 'Training',
    description: 'Train tactics from your own games.',
    glyph: PUZZLES_GLYPH,
  },
  {
    to: ROUTES.statistics,
    label: 'Insights',
    description: 'Track accuracy, errors and trends.',
    glyph: '\u{1F4C8}',
  },
  {
    to: ROUTES.analysisLive,
    label: 'Analysis',
    description: 'Analyse any position with Stockfish.',
    glyph: ANALYSIS_GLYPH,
  },
];

/**
 * Quick navigation to the four primary surfaces, rendered as descriptive cards
 * (icon + label + one-line hint). Real anchors with visible text labels; the
 * glyph is decorative and never the only label.
 */
export function HomeQuickNav(): React.JSX.Element {
  return (
    <nav className={styles.nav} aria-label="Quick links" data-testid="home-quick-nav">
      <h2 className={styles.heading}>Quick links</h2>
      <ul className={styles.list}>
        {QUICK_LINKS.map((link) => (
          <li key={link.to} className={styles.item}>
            <Link className={styles.card} to={link.to}>
              <span className={styles.icon} aria-hidden="true">
                {link.glyph}
              </span>
              <span className={styles.text}>
                <span className={styles.label}>{link.label}</span>
                <span className={styles.description}>{link.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
