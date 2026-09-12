import type * as React from 'react';
import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '@/app/routes';
import styles from './Navigation.module.css';

export interface NavigationProps {
  /** DOM id so a menu button can reference it via `aria-controls`. */
  readonly id?: string;
  /** Invoked after a link is activated (used to close the mobile menu). */
  readonly onNavigate?: () => void;
  /** Whether the mobile dropdown panel is open (no effect on desktop). */
  readonly open?: boolean;
}

export function Navigation({
  id,
  onNavigate,
  open = false,
}: NavigationProps = {}): React.JSX.Element {
  return (
    <nav
      id={id}
      className={[styles.nav, open ? styles.navOpen : ''].filter(Boolean).join(' ')}
      aria-label="Primary"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            [styles.link, isActive ? styles.active : ''].filter(Boolean).join(' ')
          }
          data-testid={`nav-${item.label.toLowerCase()}`}
        >
          {item.glyph ? (
            <span className={styles.glyph} aria-hidden="true">
              {item.glyph}
            </span>
          ) : null}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
