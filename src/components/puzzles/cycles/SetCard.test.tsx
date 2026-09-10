import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SetCard } from './SetCard';
import { cycleFixture, setFixture } from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

describe('SetCard', () => {
  it('states absent data in words rather than a bare zero', () => {
    renderWithProviders(
      <SetCard
        set={setFixture({ id: 's', name: 'Empty set' })}
        puzzleCount={0}
        cycle={null}
        lastActivityAt={null}
        to="/puzzles/sets/s"
      />,
    );

    expect(screen.getByTestId('set-card-count-s')).toHaveTextContent('No puzzles yet');
    expect(screen.getByTestId('set-card-cycle-s')).toHaveTextContent('No cycles yet');
    expect(screen.getByTestId('set-card-activity-s')).toHaveTextContent('No activity yet');
    expect(screen.getByTestId('set-card-count-s')).not.toHaveTextContent('0');
  });

  it('links to the set detail and shows the current cycle', () => {
    renderWithProviders(
      <SetCard
        set={setFixture({ id: 's2', name: 'Tactics' })}
        puzzleCount={2}
        cycle={cycleFixture({ cycleNumber: 4, status: 'completed' })}
        lastActivityAt={1_700_000_000_000}
        to="/puzzles/sets/s2"
      />,
    );

    expect(screen.getByTestId('set-card-open-s2')).toHaveAttribute('href', '/puzzles/sets/s2');
    expect(screen.getByTestId('set-card-cycle-s2')).toHaveTextContent('Cycle 4 · Completed');
    expect(screen.getByTestId('set-card-count-s2')).toHaveTextContent('2 puzzles');
  });
});
