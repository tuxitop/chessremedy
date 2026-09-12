import { useEffect, useState } from 'react';
import type * as React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
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
  // The menu is "open" only while the current path is the one it was opened
  // on. Deriving it from the pathname (instead of an effect) means any route
  // change — link, back/forward, redirect — closes it without a cascading
  // render, and it satisfies `react-hooks/set-state-in-effect`.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const location = useLocation();
  const menuOpen = menuPath === location.pathname;
  const { hidden, headerRef } = useHeaderVisibility({
    forceVisible: headerSurfaceOpen || menuOpen,
  });

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuPath(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

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
        <Navigation id="primary-nav" open={menuOpen} onNavigate={() => setMenuPath(null)} />
        <span className={styles.spacer} />
        <SyncStatusIndicator />
        <ThemeToggle />
        <button
          type="button"
          className={styles.menuButton}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          onClick={() => setMenuPath(menuOpen ? null : location.pathname)}
          data-testid="nav-menu-toggle"
        >
          <span aria-hidden="true" className={styles.menuIcon}>
            {menuOpen ? '✕' : '☰'}
          </span>
        </button>
      </header>
      <main className={styles.main} id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
