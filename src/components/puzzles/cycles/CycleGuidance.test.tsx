import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { CycleGuidance } from './CycleGuidance';
import { computeCycleMetrics } from '@/domain/training';
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

const EMPTY = computeCycleMetrics({ puzzleIds: [], attempts: [] });

describe('CycleGuidance', () => {
  it('frames the first cycle and shows the band and plan as text', () => {
    renderWithProviders(
      <CycleGuidance
        metrics={measured(6_000)}
        previous={null}
        previousCycleNumber={null}
        cycleNumber={1}
        testId="g"
      />,
    );

    expect(screen.getByTestId('g-time-goal')).toHaveTextContent('Total solving time: 0:06');
    expect(screen.getByTestId('g-time-goal')).toHaveTextContent('first cycle');
    expect(screen.getByTestId('g-time-goal')).not.toHaveTextContent('Target: beat');
    expect(screen.getByTestId('g-band')).toHaveTextContent('60–75%');
    expect(screen.getByTestId('g-band')).toHaveTextContent('above the band');
    expect(screen.getByTestId('g-plan')).toHaveTextContent('Cycle 1 of ~6');
    expect(screen.getByTestId('g-note')).toHaveTextContent('never blocks');
  });

  it('shows the total-time delta and the half-time target for a later cycle', () => {
    renderWithProviders(
      <CycleGuidance
        metrics={measured(4_000)}
        previous={measured(10_000)}
        previousCycleNumber={1}
        cycleNumber={2}
        testId="g"
      />,
    );

    const timeGoal = screen.getByTestId('g-time-goal');
    expect(timeGoal).toHaveTextContent('Total solving time: 0:04');
    expect(timeGoal).toHaveTextContent('Previous cycle (cycle 1): 0:10');
    expect(timeGoal).toHaveTextContent('change −0:06');
    expect(timeGoal).toHaveTextContent('Target: beat 0:05');
  });

  it('announces the time-halving guidance politely', () => {
    renderWithProviders(
      <CycleGuidance
        metrics={measured(4_000)}
        previous={measured(10_000)}
        previousCycleNumber={1}
        cycleNumber={2}
        testId="g"
      />,
    );

    const timeGoal = screen.getByTestId('g-time-goal');
    expect(timeGoal).toHaveAttribute('role', 'status');
    expect(timeGoal).toHaveAttribute('aria-live', 'polite');
  });

  it('states absent previous and current times honestly', () => {
    const { rerender } = renderWithProviders(
      <CycleGuidance
        metrics={measured(4_000)}
        previous={EMPTY}
        previousCycleNumber={1}
        cycleNumber={2}
        testId="g"
      />,
    );
    expect(screen.getByTestId('g-time-goal')).toHaveTextContent('recorded no solving time');
    expect(screen.getByTestId('g-time-goal')).not.toHaveTextContent('Target: beat');

    rerender(
      <CycleGuidance
        metrics={EMPTY}
        previous={measured(10_000)}
        previousCycleNumber={1}
        cycleNumber={2}
        testId="g"
      />,
    );
    expect(screen.getByTestId('g-time-goal')).toHaveTextContent('no completed puzzles yet');
    expect(screen.getByTestId('g-time-goal')).not.toHaveTextContent('0:00');
  });

  it('reports a first-cycle first-try rate below the band', () => {
    const below = computeCycleMetrics({
      puzzleIds: ['p1', 'p2'],
      attempts: attemptRowsForCycle({
        puzzleIds: ['p1', 'p2'],
        results: { p1: ['solvedFirstTry'], p2: ['failed'] },
      }),
    });
    renderWithProviders(
      <CycleGuidance
        metrics={below}
        previous={null}
        previousCycleNumber={null}
        cycleNumber={1}
        testId="g"
      />,
    );

    expect(screen.getByTestId('g-band')).toHaveTextContent('50%');
    expect(screen.getByTestId('g-band')).toHaveTextContent('below the band');
  });

  it('reports a first-cycle first-try rate within the band', () => {
    const within = computeCycleMetrics({
      puzzleIds: ['p1', 'p2', 'p3'],
      attempts: attemptRowsForCycle({
        puzzleIds: ['p1', 'p2', 'p3'],
        results: { p1: ['solvedFirstTry'], p2: ['solvedFirstTry'], p3: ['failed'] },
      }),
    });
    renderWithProviders(
      <CycleGuidance
        metrics={within}
        previous={null}
        previousCycleNumber={null}
        cycleNumber={1}
        testId="g"
      />,
    );

    expect(screen.getByTestId('g-band')).toHaveTextContent('67%');
    expect(screen.getByTestId('g-band')).toHaveTextContent('within the band');
  });

  it('uses an explicit planned cycle count when supplied', () => {
    renderWithProviders(
      <CycleGuidance
        metrics={measured(4_000)}
        previous={null}
        previousCycleNumber={null}
        cycleNumber={3}
        plannedCycles={10}
        testId="g"
      />,
    );

    expect(screen.getByTestId('g-plan')).toHaveTextContent('Cycle 3 of 10');
    expect(screen.getByTestId('g-plan')).not.toHaveTextContent('~');
  });
});
