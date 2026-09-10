/**
 * CycleResultsPage tests (Feature 013, Stage F).
 *
 * Real Dexie over fake-indexeddb (shared test setup) with deterministic
 * injected clock/id. Covers the completed/abandoned/in-progress states, the
 * per-puzzle outcomes, the canonical aggregates with sample sizes (`empty`, not
 * `0`, when nothing is definite), the same-set cross-cycle comparison and
 * "Start next cycle". No engine, no network.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { PuzzleRow } from '@/domain/puzzle';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { cycleFixture, setFixture, attemptRowsForCycle } from '@/domain/training/test-support';
import type { TrainingResult } from '@/domain/training';
import { db } from '@/infrastructure/db/database';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { CycleService } from '@/infrastructure/training';
import { renderWithProviders } from '@/test/test-utils';
import { CycleResultsPage } from './CycleResultsPage';

const NOW = 1_700_000_000_000;
const SET_ID = 'set-results';

function puzzleFor(ply: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: 'game:results', sourcePly: ply };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

function makeService(): CycleService {
  return new CycleService({
    cycles: trainingCyclesRepository,
    sets: trainingSetsRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    now: () => NOW,
    newId: () => `cycle-${Date.now()}`,
  });
}

async function persist(rows: ReturnType<typeof attemptRowsForCycle>): Promise<void> {
  for (const row of rows) {
    await attemptsRepository.addAttempt(row);
  }
}

interface SeedOptions {
  readonly cycleNumber: number;
  readonly status: 'inProgress' | 'completed' | 'abandoned';
  readonly puzzleIds: readonly string[];
  readonly results: Readonly<Record<string, readonly TrainingResult[]>>;
}

async function seedCycle(options: SeedOptions): Promise<void> {
  const cycleId = `cycle-${options.cycleNumber}`;
  await trainingCyclesRepository.create(
    cycleFixture({
      id: cycleId,
      trainingSetId: SET_ID,
      cycleNumber: options.cycleNumber,
      status: options.status,
      puzzleIds: options.puzzleIds,
      completedAt: options.status === 'completed' ? NOW + 60_000 : null,
      abandonedAt: options.status === 'abandoned' ? NOW + 30_000 : null,
    }),
  );
  await persist(
    attemptRowsForCycle({
      puzzleIds: options.puzzleIds,
      results: options.results,
      trainingSetId: SET_ID,
      cycleId,
    }),
  );
}

async function seedSet(): Promise<readonly [PuzzleRow, PuzzleRow]> {
  const rows = [puzzleFor(6), puzzleFor(8)] as const;
  await puzzlesRepository.addIfAbsent(rows);
  await trainingSetsRepository.create(
    setFixture({ id: SET_ID, name: 'Tactics set', puzzleIds: rows.map(idOf) }),
  );
  return rows;
}

function renderResults(cycleNumber: number, service: CycleService): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber/results"
        element={<CycleResultsPage cycleService={service} now={() => NOW} />}
      />
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber"
        element={<div data-testid="cycle-session-stub" />}
      />
      <Route path="/puzzles/sets/:setId" element={<div data-testid="set-detail-stub" />} />
    </Routes>,
    { initialEntries: [`/puzzles/sets/${SET_ID}/cycles/${cycleNumber}/results`] },
  );
}

async function waitForResults(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('cycle-results-status')).toBeInTheDocument());
}

describe('CycleResultsPage (Feature 013, Stage F)', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
    await db.games.clear();
  });

  it('shows the completed cycle, per-puzzle outcomes and aggregates with sample sizes', async () => {
    const [p1, p2] = await seedSet();
    const service = makeService();
    await seedCycle({
      cycleNumber: 1,
      status: 'completed',
      puzzleIds: [idOf(p1), idOf(p2)],
      results: { [idOf(p1)]: ['solvedFirstTry'], [idOf(p2)]: ['failed', 'solvedWithHelp'] },
    });

    renderResults(1, service);
    await waitForResults();

    expect(screen.getByTestId('cycle-results-set-name')).toHaveTextContent('Tactics set');
    expect(screen.getByTestId('cycle-results-cycle-number')).toHaveTextContent('Cycle 1');
    expect(screen.getByTestId('cycle-results-status')).toHaveTextContent('Completed');
    expect(screen.getByTestId('cycle-results-outcomes-result-1')).toHaveTextContent(
      'Solved first try',
    );
    expect(screen.getByTestId('cycle-results-outcomes-result-2')).toHaveTextContent(
      'Solved with hints',
    );
    expect(screen.getByTestId('cycle-results-outcomes-detail-2')).toHaveTextContent('1 retry');
    expect(screen.getByTestId('cycle-results-metrics-first-try')).toHaveTextContent(
      '(n = 2 completed)',
    );
    expect(screen.getByTestId('cycle-results-next-cycle')).toBeInTheDocument();
    expect(screen.queryByTestId('cycle-results-comparison')).not.toBeInTheDocument();
  });

  it('reports empty (not 0) rate and time aggregates when nothing is definite', async () => {
    const [p1, p2] = await seedSet();
    const service = makeService();
    await seedCycle({
      cycleNumber: 1,
      status: 'completed',
      puzzleIds: [idOf(p1), idOf(p2)],
      results: { [idOf(p1)]: ['skipped'], [idOf(p2)]: ['skipped'] },
    });

    renderResults(1, service);
    await waitForResults();

    expect(screen.getByTestId('cycle-results-metrics-first-try')).toHaveTextContent('empty');
    expect(screen.getByTestId('cycle-results-metrics-solve-rate')).toHaveTextContent('empty');
    expect(screen.getByTestId('cycle-results-metrics-first-try')).not.toHaveTextContent('0');
    expect(screen.getByTestId('cycle-results-metrics-skipped')).toHaveTextContent('2');
  });

  it('shows an abandoned cycle separately and never offers to resume it', async () => {
    const [p1] = await seedSet();
    const service = makeService();
    await seedCycle({
      cycleNumber: 1,
      status: 'abandoned',
      puzzleIds: [idOf(p1)],
      results: { [idOf(p1)]: ['solvedFirstTry'] },
    });

    renderResults(1, service);
    await waitForResults();

    expect(screen.getByTestId('cycle-results-status')).toHaveTextContent('Abandoned');
    expect(screen.getByTestId('cycle-results-abandoned')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-results-abandoned-note')).toHaveTextContent(
      'cannot be resumed',
    );
    expect(screen.queryByTestId('cycle-results-resume')).not.toBeInTheDocument();
    expect(screen.getByTestId('cycle-results-next-cycle')).toBeInTheDocument();
  });

  it('shows partial aggregates and a resume action for an in-progress cycle', async () => {
    const [p1, p2] = await seedSet();
    const service = makeService();
    await seedCycle({
      cycleNumber: 1,
      status: 'inProgress',
      puzzleIds: [idOf(p1), idOf(p2)],
      results: { [idOf(p1)]: ['solvedFirstTry'] },
    });

    renderResults(1, service);
    await waitForResults();

    expect(screen.getByTestId('cycle-results-status')).toHaveTextContent('In progress');
    expect(screen.getByTestId('cycle-results-partial-note')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-results-resume')).toHaveAttribute(
      'href',
      `/puzzles/sets/${SET_ID}/cycles/1`,
    );
    expect(screen.queryByTestId('cycle-results-next-cycle')).not.toBeInTheDocument();
  });

  it('compares with the previous cycle of the same set using measured deltas only', async () => {
    const [p1, p2] = await seedSet();
    const service = makeService();
    await seedCycle({
      cycleNumber: 1,
      status: 'completed',
      puzzleIds: [idOf(p1), idOf(p2)],
      results: { [idOf(p1)]: ['solvedFirstTry'], [idOf(p2)]: ['failed'] },
    });
    await seedCycle({
      cycleNumber: 2,
      status: 'completed',
      puzzleIds: [idOf(p1), idOf(p2)],
      results: { [idOf(p1)]: ['solvedFirstTry'], [idOf(p2)]: ['solvedFirstTry'] },
    });

    renderResults(2, service);
    await waitForResults();

    expect(screen.getByTestId('cycle-results-comparison')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-results-comparison-note')).toHaveTextContent(
      'do not show that training caused',
    );
    expect(
      screen.getByTestId('cycle-results-comparison-current-firstTryAccuracy'),
    ).toHaveTextContent('100%');
    expect(
      screen.getByTestId('cycle-results-comparison-previous-firstTryAccuracy'),
    ).toHaveTextContent('50%');
    expect(screen.getByTestId('cycle-results-comparison-delta-firstTryAccuracy')).toHaveTextContent(
      '+50%',
    );
  });

  it('starts the next cycle and opens its session', async () => {
    const [p1] = await seedSet();
    const service = makeService();
    await seedCycle({
      cycleNumber: 1,
      status: 'completed',
      puzzleIds: [idOf(p1)],
      results: { [idOf(p1)]: ['solvedFirstTry'] },
    });

    renderResults(1, service);
    await waitForResults();

    fireEvent.click(screen.getByTestId('cycle-results-next-cycle'));

    await screen.findByTestId('cycle-session-stub');
    const cycles = await trainingCyclesRepository.listForSet(SET_ID);
    expect(cycles.map((cycle) => cycle.cycleNumber)).toEqual([1, 2]);
    expect(cycles[1]!.status).toBe('inProgress');
  });

  it('shows a missing state when the cycle does not exist', async () => {
    await seedSet();
    renderResults(9, makeService());

    await screen.findByTestId('cycle-results-missing');
    expect(screen.getByTestId('cycle-results-back')).toHaveAttribute('href', '/puzzles');
  });
});
