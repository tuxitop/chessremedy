import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { ChartErrorBoundary } from './ChartErrorBoundary';

let throwEnabled = true;

function Flaky(): React.JSX.Element {
  if (throwEnabled) {
    throw new Error('chart boom');
  }
  return <p>Recovered chart</p>;
}

describe('ChartErrorBoundary', () => {
  beforeEach(() => {
    throwEnabled = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isolates a chart render failure with a non-crashing fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(
      <ChartErrorBoundary>
        <Flaky />
      </ChartErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This chart could not be displayed.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('retries the chart after the failure is resolved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <ChartErrorBoundary>
        <Flaky />
      </ChartErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    throwEnabled = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Recovered chart')).toBeInTheDocument();
  });
});
