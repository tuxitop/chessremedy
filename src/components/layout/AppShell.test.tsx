// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { AppShell, type AppShellProps } from './AppShell';
import { Routes, Route } from 'react-router-dom';

function renderWithOutlet(props: AppShellProps = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<AppShell {...props} />}>
        <Route index element={<div data-testid="outlet">Home content</div>} />
        <Route path="games" element={<div data-testid="games-outlet">Games</div>} />
      </Route>
    </Routes>,
    { initialEntries: ['/'] },
  );
}

/** happy-dom/jsdom expose `scrollY` as a getter; override it per test. */
function setScrollY(value: number): void {
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value });
}

const APP_SHELL_CSS = readFileSync(
  resolve(process.cwd(), 'src/components/layout/AppShell.module.css'),
  'utf8',
);

describe('AppShell', () => {
  it('renders the brand and nav links', () => {
    renderWithOutlet();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByText('ChessRemedy')).toBeInTheDocument();
    for (const label of ['Home', 'Games', 'Training', 'Statistics', 'Analysis', 'Settings']) {
      expect(screen.getByTestId(`nav-${label.toLowerCase()}`)).toBeInTheDocument();
    }
  });

  it('renders the routed outlet content', () => {
    renderWithOutlet();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.getByText('Home content')).toBeInTheDocument();
  });

  it('includes the theme toggle', () => {
    renderWithOutlet();
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });

  it('renders a skip link targeting the main content region', () => {
    renderWithOutlet();
    const skip = screen.getByTestId('skip-to-content');
    expect(skip).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('toggles the mobile menu and closes it on Escape', () => {
    renderWithOutlet();
    const button = screen.getByTestId('nav-menu-toggle');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'primary-nav');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the mobile menu after navigating', async () => {
    renderWithOutlet();
    const button = screen.getByTestId('nav-menu-toggle');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByTestId('nav-games'));
    await waitFor(() => expect(screen.getByTestId('games-outlet')).toBeInTheDocument());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides on scroll-down and reveals on scroll-up', async () => {
    renderWithOutlet();
    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-hidden', 'false');

    setScrollY(600);
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden', 'true'));

    setScrollY(200);
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden', 'false'));
  });

  it('stays visible near the top', async () => {
    renderWithOutlet();
    const header = screen.getByRole('banner');

    setScrollY(600);
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden', 'true'));

    setScrollY(0);
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden', 'false'));
  });

  it('stays visible while a header surface is open', async () => {
    renderWithOutlet({ headerSurfaceOpen: true });
    const header = screen.getByRole('banner');

    setScrollY(600);
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden', 'false'));
  });

  it('hides with a transform and reveals on focus (reduced-motion safe)', () => {
    expect(APP_SHELL_CSS).toMatch(/\.headerHidden\s*\{[^}]*translateY\(-100%\)/);
    expect(APP_SHELL_CSS).toMatch(/\.headerHidden\s*\{[^}]*pointer-events:\s*none/);
    expect(APP_SHELL_CSS).toMatch(/\.header:focus-within\s*\{[^}]*translateY\(0\)/);
    expect(APP_SHELL_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition:\s*none/,
    );
  });
});
