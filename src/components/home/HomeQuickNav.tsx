import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { ANALYSIS_GLYPH } from '@/components/ui/icons';
import styles from './HomeQuickNav.module.css';

interface QuickLink {
  readonly to: string;
  readonly label: string;
  readonly glyph?: string;
}

const QUICK_LINKS: readonly QuickLink[] = [
  { to: ROUTES.games, label: 'Games' },
  { to: ROUTES.training, label: 'Training' },
  { to: ROUTES.statistics, label: 'Statistics' },
  { to: ROUTES.analysisLive, label: 'Analysis', glyph: ANALYSIS_GLYPH },
];

/**
 * Quick navigation to the four primary surfaces. Real anchors with visible
 * text labels; the optional glyph is decorative and never the only label.
 */
export function HomeQuickNav(): React.JSX.Element {
  return (
    <nav className={styles.nav} aria-label="Quick links" data-testid="home-quick-nav">
      <h2 className={styles.heading}>Quick links</h2>
      <ul className={styles.list}>
        {QUICK_LINKS.map((link) => (
          <li key={link.to} className={styles.item}>
            <Link className={styles.link} to={link.to}>
              {link.glyph !== undefined ? <span aria-hidden="true">{link.glyph}</span> : null}
              <span>{link.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
