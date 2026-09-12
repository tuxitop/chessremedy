import type * as React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { APP_NAME } from '@/config/app-config';
import { SyncStatusIndicator } from '@/components/sync';
import { useHeaderVisibility } from '@/hooks/useHeaderVisibility';
import { Navigation } from './Navigation';
import { ThemeToggle } from './ThemeToggle';
import styles from './AppShell.module.css';

export interface AppShellProps {
  /**
   * Set while a header surface (menu, popover, dialog) is open so the header
   * stays visible regardless of scroll direction.
   */
  headerSurfaceOpen?: boolean;
}

export function AppShell({ headerSurfaceOpen = false }: AppShellProps = {}): React.JSX.Element {
  const { hidden, headerRef } = useHeaderVisibility({ forceVisible: headerSurfaceOpen });

  return (
    <div className={styles.shell} data-testid="app-shell">
      <a className={styles.skipLink} href="#main-content" data-testid="skip-to-content">
        Skip to main content
      </a>
      <header
        ref={headerRef}
        className={[styles.header, hidden ? styles.headerHidden : ''].filter(Boolean).join(' ')}
        data-hidden={hidden ? 'true' : 'false'}
      >
        <Link to="/" className={styles.brand} aria-label={`${APP_NAME} home`}>
          <span>{APP_NAME}</span>
          <span className={styles.brandTagline}>v0.1.0</span>
        </Link>
        <Navigation />
        <span className={styles.spacer} />
        <SyncStatusIndicator />
        <ThemeToggle />
      </header>
      <main className={styles.main} id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
