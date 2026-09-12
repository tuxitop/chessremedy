import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import {
  DashboardEmpty,
  DashboardLoadError,
  DashboardLoading,
  DashboardNoTraining,
} from './DashboardStates';

describe('DashboardStates', () => {
  it('renders first-run guidance with links to Games and Analysis', () => {
    renderWithProviders(<DashboardEmpty />);
    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Games' })).toHaveAttribute('href', '/games');
    expect(screen.getByRole('link', { name: 'Open Analysis' })).toHaveAttribute(
      'href',
      '/analysis',
    );
  });

  it('renders the no-training empty state linking to Puzzles', () => {
    renderWithProviders(<DashboardNoTraining />);
    expect(screen.getByTestId('dashboard-no-training')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Training' })).toHaveAttribute(
      'href',
      '/training',
    );
  });

  it('renders an inline load error with a retry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardLoadError message="Could not load statistics." onRetry={onRetry} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load statistics.');
    await user.click(screen.getByTestId('dashboard-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('announces loading politely', () => {
    renderWithProviders(<DashboardLoading label="Loading statistics…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading statistics…');
  });
});
