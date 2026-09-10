import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { CycleComparison } from './CycleComparison';
import { compareCycleMetrics, computeCycleMetrics } from '@/domain/training';
import { attemptRowsForCycle } from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

function measured(solvingMs: number) {
  return computeCycleMetrics({
    puzzleIds: ['p1'],
    attempts: attemptRowsForCycle({
      puzzleIds: ['p1'],
      results: { p1: ['solvedFirstTry'] },
      solvingTimes: { p1: [solvingMs] },
    }),
  });
}

describe('CycleComparison', () => {
  it('reports the total solving time and its measured delta', () => {
    const comparison = compareCycleMetrics(measured(4_000), measured(10_000));
    renderWithProviders(
      <CycleComparison
        comparison={comparison}
        currentCycleNumber={2}
        previousCycleNumber={1}
        testId="cmp"
      />,
    );

    expect(screen.getByTestId('cmp-current-solvingTimeTotalMs')).toHaveTextContent('0:04');
    expect(screen.getByTestId('cmp-previous-solvingTimeTotalMs')).toHaveTextContent('0:10');
    expect(screen.getByTestId('cmp-delta-solvingTimeTotalMs')).toHaveTextContent('−0:06');
  });
});
