import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MembershipList, type MembershipListItem } from './MembershipList';
import { renderWithProviders } from '@/test/test-utils';

function items(count: number): MembershipListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `g:${index}`,
    sourceGameId: 'g',
    sourcePly: index,
    origin: 'tactical' as const,
    objective: 'Winning material',
    difficulty: 10 + index,
    difficultyBucket: 'Trivial' as const,
  }));
}

describe('MembershipList', () => {
  it('paginates rather than rendering every row', () => {
    renderWithProviders(
      <MembershipList
        items={items(30)}
        pageSize={10}
        emptyMessage="None"
        testId="ml"
        ariaLabel="Members"
      />,
    );

    expect(screen.getAllByTestId(/^ml-item-/)).toHaveLength(10);
    fireEvent.click(screen.getByTestId('ml-more'));
    expect(screen.getAllByTestId(/^ml-item-/)).toHaveLength(20);
  });

  it('renders an explicit empty message', () => {
    renderWithProviders(
      <MembershipList
        items={[]}
        emptyMessage="No puzzles match."
        testId="ml"
        ariaLabel="Members"
      />,
    );
    expect(screen.getByTestId('ml-empty')).toHaveTextContent('No puzzles match.');
  });

  it('exposes touch-friendly checkbox selection when requested', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <MembershipList
        items={items(2)}
        selectedIds={new Set(['g:0'])}
        onToggle={onToggle}
        emptyMessage="None"
        testId="ml"
        ariaLabel="Members"
      />,
    );

    expect(screen.getByTestId('ml-select-g:0')).toBeChecked();
    fireEvent.click(screen.getByTestId('ml-select-g:1'));
    expect(onToggle).toHaveBeenCalledWith('g:1');
  });
});
