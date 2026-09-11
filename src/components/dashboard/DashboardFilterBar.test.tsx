import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { DEFAULT_LIBRARY_FILTERS } from '@/domain/gameLibrary';
import { mixedDimensions } from '@/presentation/dashboard';
import { DashboardFilterBar } from './DashboardFilterBar';

describe('DashboardFilterBar', () => {
  it('shows the mixed note for All and emits canonical filter patches', async () => {
    const onFilters = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DashboardFilterBar
        filters={DEFAULT_LIBRARY_FILTERS}
        hint={null}
        mixed={mixedDimensions(DEFAULT_LIBRARY_FILTERS)}
        onFilters={onFilters}
      />,
    );

    expect(screen.getByTestId('dashboard-mixed-note')).toHaveTextContent(
      'platforms and time controls',
    );
    await user.selectOptions(screen.getByTestId('dashboard-filter-platform'), 'lichess');
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ platform: 'lichess' }));
  });

  it('hides the mixed note for a concrete partition', () => {
    const filters = {
      ...DEFAULT_LIBRARY_FILTERS,
      platform: 'lichess' as const,
      timeControl: 'rapid' as const,
    };
    renderWithProviders(
      <DashboardFilterBar
        filters={filters}
        hint={null}
        mixed={mixedDimensions(filters)}
        onFilters={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('dashboard-mixed-note')).toBeNull();
  });

  it('shows the inline hint and custom date inputs for an invalid custom range', () => {
    const filters = {
      ...DEFAULT_LIBRARY_FILTERS,
      timeFrame: { preset: 'custom' as const, from: '', to: '' },
    };
    renderWithProviders(
      <DashboardFilterBar
        filters={filters}
        hint="Choose both a start and an end date."
        mixed={mixedDimensions(filters)}
        onFilters={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Choose both a start and an end date.');
    expect(screen.getByTestId('dashboard-date-from')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-date-to')).toBeInTheDocument();
  });
});
