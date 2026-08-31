import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { AppShell } from './AppShell';
import { Routes, Route } from 'react-router-dom';

function renderWithOutlet() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<div data-testid="outlet">Home content</div>} />
      </Route>
    </Routes>,
    { initialEntries: ['/'] },
  );
}

describe('AppShell', () => {
  it('renders the brand and nav links', () => {
    renderWithOutlet();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByText('ChessRemedy')).toBeInTheDocument();
    for (const label of ['Home', 'Games', 'Analysis', 'Puzzles', 'Dashboard', 'Settings']) {
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
});
