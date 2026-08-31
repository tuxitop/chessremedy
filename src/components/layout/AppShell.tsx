import type * as React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { APP_NAME } from '@/config/app-config';
import { Navigation } from './Navigation';
import { ThemeToggle } from './ThemeToggle';
import styles from './AppShell.module.css';

export function AppShell(): React.JSX.Element {
  return (
    <div className={styles.shell} data-testid="app-shell">
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label={`${APP_NAME} home`}>
          <span>{APP_NAME}</span>
          <span className={styles.brandTagline}>v0.1.0</span>
        </Link>
        <Navigation />
        <span className={styles.spacer} />
        <ThemeToggle />
      </header>
      <main className={styles.main} id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
