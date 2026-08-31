import type * as React from 'react';
import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '@/app/routes';
import styles from './Navigation.module.css';

export function Navigation(): React.JSX.Element {
  return (
    <nav className={styles.nav} aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            [styles.link, isActive ? styles.active : ''].filter(Boolean).join(' ')
          }
          data-testid={`nav-${item.label.toLowerCase()}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
