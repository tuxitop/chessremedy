import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SessionTimer } from './SessionTimer';
import { renderWithProviders } from '@/test/test-utils';

describe('SessionTimer', () => {
  it('renders nothing for an untimed session', () => {
    renderWithProviders(<SessionTimer remainingMs={null} warning={false} />);
    expect(screen.queryByTestId('session-timer')).not.toBeInTheDocument();
  });

  it('shows a quiet mm:ss readout in the normal state', () => {
    renderWithProviders(<SessionTimer remainingMs={65_000} warning={false} />);

    const timer = screen.getByTestId('session-timer');
    expect(timer).toHaveAttribute('data-state', 'normal');
    expect(timer).toHaveAttribute('role', 'timer');
    expect(timer).toHaveAttribute('aria-live', 'off');
    expect(screen.getByTestId('session-timer-readout')).toHaveTextContent('1:05');
    expect(screen.getByTestId('session-timer-bar')).toBeInTheDocument();
  });

  it('marks the warning state in colour and text', () => {
    renderWithProviders(<SessionTimer remainingMs={20_000} warning />);

    const timer = screen.getByTestId('session-timer');
    expect(timer).toHaveAttribute('data-state', 'warning');
    expect(timer).toHaveAttribute('aria-label', 'Time remaining: 0:20 — warning');
    expect(screen.getByTestId('session-timer-readout')).toHaveTextContent('0:20');
  });

  it('marks the expired state in colour and text', () => {
    renderWithProviders(<SessionTimer remainingMs={0} warning={false} expired />);

    const timer = screen.getByTestId('session-timer');
    expect(timer).toHaveAttribute('data-state', 'expired');
    expect(timer).toHaveAttribute('aria-label', 'Time remaining: 0:00 — expired');
    expect(screen.getByTestId('session-timer-readout')).toHaveTextContent('0:00');
  });
});
