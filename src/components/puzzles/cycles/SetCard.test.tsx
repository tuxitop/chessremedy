import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SetCard } from './SetCard';
import { blockSetFixture, cycleFixture, setFixture } from '@/domain/training/test-support';
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

  it('links to the set detail and shows the current cycle for a custom set', () => {
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
    // A custom set carries no Woodpecker-block badge or size.
    expect(screen.queryByTestId('set-card-badge-s2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('set-card-block-size-s2')).not.toBeInTheDocument();
  });

  it('badges a Woodpecker block and shows its fixed recipe size', () => {
    renderWithProviders(
      <SetCard
        set={blockSetFixture({ id: 'block', name: 'Woodpecker block', puzzleIds: ['g:1', 'g:2'] })}
        puzzleCount={2}
        cycle={null}
        lastActivityAt={null}
        to="/puzzles/sets/block"
      />,
    );

    expect(screen.getByTestId('set-card-badge-block')).toHaveTextContent('Woodpecker block');
    expect(screen.getByTestId('set-card-block-size-block')).toHaveTextContent('200 puzzles');
    expect(screen.getByTestId('set-card-note-block')).toHaveTextContent(/fixed/i);
    expect(screen.getByTestId('set-card-count-block')).toHaveTextContent('2 puzzles');
  });

  it('states a block with no surviving puzzles in words, never a bare zero', () => {
    renderWithProviders(
      <SetCard
        set={blockSetFixture({ id: 'block-empty', name: 'Woodpecker block' })}
        puzzleCount={0}
        cycle={null}
        lastActivityAt={null}
        to="/puzzles/sets/block-empty"
        emptyCountLabel="No puzzles yet"
      />,
    );

    expect(screen.getByTestId('set-card-count-block-empty')).toHaveTextContent('No puzzles yet');
    expect(screen.getByTestId('set-card-count-block-empty')).not.toHaveTextContent('0');
  });
});
