import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { RepeatedlyFailedList } from './RepeatedlyFailedList';

const items = [
  {
    puzzleId: 'fixture:dashboard:1',
    sourceGameId: 'fixture:dashboard',
    failureCount: 3,
    cycleCount: 3,
    lastFailedAt: Date.UTC(2026, 8, 10, 12, 0, 0),
  },
];

describe('RepeatedlyFailedList', () => {
  it('links each repeatedly failed puzzle to its source-game puzzles view', () => {
    renderWithProviders(<RepeatedlyFailedList items={items} />);

    const table = screen.getByTestId('repeatedly-failed');
    expect(within(table).getByRole('link', { name: 'fixture:dashboard:1' })).toHaveAttribute(
      'href',
      '/games/fixture:dashboard/puzzles',
    );
    expect(within(table).getAllByText('3')).toHaveLength(2);
    expect(within(table).getByText('2026-09-10')).toBeInTheDocument();
  });

  it('renders an explicit empty state', () => {
    renderWithProviders(<RepeatedlyFailedList items={[]} />);
    expect(screen.getByTestId('repeatedly-failed-empty')).toHaveTextContent(
      'No puzzle has been failed in two or more cycles',
    );
  });
});
