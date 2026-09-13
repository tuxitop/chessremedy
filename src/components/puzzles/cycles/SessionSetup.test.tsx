import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SessionSetup } from './SessionSetup';
import { DEFAULT_SESSION_DURATION_MS } from '@/domain/training';
import { renderWithProviders } from '@/test/test-utils';

describe('SessionSetup', () => {
  it('offers every duration option plus No time limit', () => {
    renderWithProviders(
      <SessionSetup defaultDurationMs={DEFAULT_SESSION_DURATION_MS} onBegin={vi.fn()} />,
    );

    expect(screen.getByTestId('session-duration-5')).toHaveTextContent('5 min');
    expect(screen.getByTestId('session-duration-10')).toHaveTextContent('10 min');
    expect(screen.getByTestId('session-duration-60')).toHaveTextContent('60 min');
    expect(screen.getByTestId('session-duration-none')).toHaveTextContent('No time limit');
  });

  it('preselects the default duration and begins with it', () => {
    const onBegin = vi.fn();
    renderWithProviders(
      <SessionSetup defaultDurationMs={DEFAULT_SESSION_DURATION_MS} onBegin={onBegin} />,
    );

    expect(screen.getByTestId('session-duration-10')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('session-duration-none')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByTestId('session-begin'));
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onBegin).toHaveBeenCalledWith(DEFAULT_SESSION_DURATION_MS);
  });

  it('begins with the newly selected duration', () => {
    const onBegin = vi.fn();
    renderWithProviders(
      <SessionSetup defaultDurationMs={DEFAULT_SESSION_DURATION_MS} onBegin={onBegin} />,
    );

    fireEvent.click(screen.getByTestId('session-duration-15'));
    expect(screen.getByTestId('session-duration-15')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('session-duration-10')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByTestId('session-begin'));
    expect(onBegin).toHaveBeenCalledWith(15 * 60_000);
  });

  it('begins with null for No time limit', () => {
    const onBegin = vi.fn();
    renderWithProviders(
      <SessionSetup defaultDurationMs={DEFAULT_SESSION_DURATION_MS} onBegin={onBegin} />,
    );

    fireEvent.click(screen.getByTestId('session-duration-none'));
    expect(screen.getByTestId('session-duration-none')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByTestId('session-begin'));
    expect(onBegin).toHaveBeenCalledWith(null);
  });

  it('calls onCancel when provided', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <SessionSetup
        defaultDurationMs={DEFAULT_SESSION_DURATION_MS}
        onBegin={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId('session-setup-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
