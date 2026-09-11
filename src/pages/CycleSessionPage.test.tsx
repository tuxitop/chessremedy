/**
 * CycleSessionPage tests (Feature 013, Stage F).
 *
 * Real Dexie over fake-indexeddb (shared test setup) with a deterministic
 * injected clock/id. Feature 012's `SolveScreen` is replaced by a controllable
 * stub so the tests exercise the session chrome and the host wiring (durable
 * write → advance, completion → results, exit → set detail) without mounting
 * the board or engine. No engine, no network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { PuzzleRow } from '@/domain/puzzle';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { DEFAULT_CYCLE_CONFIG, QUICK_TRAIN_SET_ID } from '@/domain/training';
import { blockSetFixture, cycleFixture, setFixture } from '@/domain/training/test-support';
import { db } from '@/infrastructure/db/database';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { CycleService } from '@/infrastructure/training';
import { renderWithProviders } from '@/test/test-utils';
import { CycleSessionPage } from './CycleSessionPage';

vi.mock('@/components/puzzles/solve', () => ({
  SolveScreen: (props: {
    readonly row: PuzzleRow;
    readonly context: { readonly presentationIndex: number };
    readonly recorder: {
      record: (input: unknown) => Promise<{ attemptRow: unknown }>;
    };
    readonly onExit: (outcome: unknown) => void;
    readonly allowSkip: boolean;
  }) => (
    <div data-testid="solve-stub">
      <span data-testid="solve-stub-puzzle">
        {props.row.sourceGameId}:{props.row.sourcePly}
      </span>
      <span data-testid="solve-stub-presentation">{props.context.presentationIndex}</span>
      <span data-testid="solve-stub-allow-skip">{String(props.allowSkip)}</span>
      <button
        data-testid="solve-stub-solve"
        onClick={() => {
          void (async () => {
            const { attemptRow } = await props.recorder.record({
              row: props.row,
              context: props.context,
              trigger: 'solved',
              counters: { wrongMoveCount: 0, hintCount: 0, highestHintLevel: null },
              startedAt: 1_700_000_000_000,
            });
            props.onExit(attemptRow);
          })();
        }}
      >
        Solve
      </button>
      <button data-testid="solve-stub-discard" onClick={() => props.onExit(null)}>
        Discard
      </button>
    </div>
  ),
}));

/** Local noon so same-day/next-day spacing cases are time-zone independent. */
const NOW = new Date(2023, 10, 14, 12, 0, 0, 0).getTime();
const SET_ID = 'set-session';

function puzzleFor(ply: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: 'game:session', sourcePly: ply };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

function makeService(): CycleService {
  let nextId = 0;
  return new CycleService({
    cycles: trainingCyclesRepository,
    sets: trainingSetsRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    now: () => NOW,
    newId: () => `cycle-${(nextId += 1)}`,
  });
}

async function seedCycle(options: { readonly allowSkip?: boolean } = {}): Promise<{
  readonly rows: readonly PuzzleRow[];
  readonly service: CycleService;
}> {
  const rows = [puzzleFor(6), puzzleFor(8)];
  await puzzlesRepository.addIfAbsent(rows);
  await trainingSetsRepository.create(
    setFixture({
      id: SET_ID,
      name: 'Tactics set',
      puzzleIds: rows.map(idOf),
      config: { ...DEFAULT_CYCLE_CONFIG, allowSkip: options.allowSkip ?? true },
    }),
  );
  const service = makeService();
  const started = await service.start(SET_ID);
  if (!started.ok) {
    throw new Error('expected the seeded cycle to start');
  }
  return { rows, service };
}

function renderSession(service: CycleService, cycleNumber = 1): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber"
        element={<CycleSessionPage cycleService={service} now={() => NOW} />}
      />
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber/results"
        element={<div data-testid="cycle-results-stub" />}
      />
      <Route path="/puzzles/sets/:setId" element={<div data-testid="set-detail-stub" />} />
    </Routes>,
    { initialEntries: [`/puzzles/sets/${SET_ID}/cycles/${cycleNumber}`] },
  );
}

async function waitForChrome(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('solve-stub')).toBeInTheDocument());
}

/** Render a Quick-train session at the reserved sentinel path. */
function renderQuickTrain(service: CycleService): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber"
        element={<CycleSessionPage cycleService={service} now={() => NOW} />}
      />
      <Route path="/puzzles" element={<div data-testid="training-home-stub" />} />
    </Routes>,
    { initialEntries: [`/puzzles/sets/${QUICK_TRAIN_SET_ID}/cycles/1`] },
  );
}

const BLOCK_ID = 'set-block';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Seed a block with a terminal previous cycle and a current in-progress cycle. */
async function seedBlockWithPreviousCycle(gapMs: number): Promise<CycleService> {
  const rows = [puzzleFor(6)];
  await puzzlesRepository.addIfAbsent(rows);
  await trainingSetsRepository.create(
    blockSetFixture({ id: BLOCK_ID, name: 'Woodpecker block', puzzleIds: rows.map(idOf) }),
  );
  const previousEnd = NOW - gapMs;
  await trainingCyclesRepository.create(
    cycleFixture({
      id: 'cycle-prev',
      trainingSetId: BLOCK_ID,
      cycleNumber: 1,
      status: 'completed',
      startedAt: previousEnd - 60_000,
      completedAt: previousEnd,
      puzzleIds: rows.map(idOf),
    }),
  );
  await trainingCyclesRepository.create(
    cycleFixture({
      id: 'cycle-current',
      trainingSetId: BLOCK_ID,
      cycleNumber: 2,
      status: 'inProgress',
      startedAt: NOW,
      puzzleIds: rows.map(idOf),
    }),
  );
  return makeService();
}

function renderBlockSession(service: CycleService): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber"
        element={<CycleSessionPage cycleService={service} now={() => NOW} />}
      />
      <Route path="/puzzles/sets/:setId" element={<div data-testid="set-detail-stub" />} />
    </Routes>,
    { initialEntries: [`/puzzles/sets/${BLOCK_ID}/cycles/2`] },
  );
}

describe('CycleSessionPage (Feature 013, Stage F)', () => {
  beforeEach(async () => {
    await db.trainingSets.clear();
    await db.trainingCycles.clear();
    await db.puzzleAttempts.clear();
    await db.puzzles.clear();
    await db.games.clear();
  });

  it('renders the session chrome and mounts the solving screen for the first puzzle', async () => {
    const { service } = await seedCycle();
    renderSession(service);
    await waitForChrome();

    expect(screen.getByTestId('cycle-session-set-name')).toHaveTextContent('Tactics set');
    expect(screen.getByTestId('cycle-session-cycle-number')).toHaveTextContent('Cycle 1');
    expect(screen.getByTestId('cycle-session-progress')).toHaveTextContent('Puzzle 1 of 2');
    expect(screen.getByTestId('solve-stub-puzzle')).toHaveTextContent('game:session:6');
    expect(screen.getByTestId('solve-stub-presentation')).toHaveTextContent('1');
    expect(screen.getByTestId('solve-stub-allow-skip')).toHaveTextContent('true');
  });

  it('advances only after the attempt row is durably written', async () => {
    const { service } = await seedCycle();
    renderSession(service);
    await waitForChrome();

    // A discarded presentation writes no row and keeps the same puzzle.
    fireEvent.click(screen.getByTestId('solve-stub-discard'));
    await waitFor(() =>
      expect(screen.getByTestId('cycle-session-notice')).toHaveTextContent('discarded'),
    );
    expect(screen.getByTestId('solve-stub-puzzle')).toHaveTextContent('game:session:6');
    expect(screen.getByTestId('cycle-session-progress')).toHaveTextContent('Puzzle 1 of 2');

    // A durable solve advances to the second puzzle.
    fireEvent.click(screen.getByTestId('solve-stub-solve'));
    await waitFor(() =>
      expect(screen.getByTestId('cycle-session-progress')).toHaveTextContent('Puzzle 2 of 2'),
    );
    expect(screen.getByTestId('solve-stub-puzzle')).toHaveTextContent('game:session:8');
  });

  it('navigates to the results when the cycle completes and marks it completed', async () => {
    const { service } = await seedCycle();
    renderSession(service);
    await waitForChrome();

    fireEvent.click(screen.getByTestId('solve-stub-solve'));
    await waitFor(() =>
      expect(screen.getByTestId('cycle-session-progress')).toHaveTextContent('Puzzle 2 of 2'),
    );
    fireEvent.click(screen.getByTestId('solve-stub-solve'));

    await screen.findByTestId('cycle-results-stub');
    const cycles = await trainingCyclesRepository.listForSet(SET_ID);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.status).toBe('completed');
  });

  it('exits without completing, leaving the cycle inProgress and resumable', async () => {
    const { service } = await seedCycle();
    renderSession(service);
    await waitForChrome();

    fireEvent.click(screen.getByTestId('cycle-session-exit'));

    await screen.findByTestId('set-detail-stub');
    const cycles = await trainingCyclesRepository.listForSet(SET_ID);
    expect(cycles[0]!.status).toBe('inProgress');
  });

  it('hides Skip when the cycle config disallows it', async () => {
    const { service } = await seedCycle({ allowSkip: false });
    renderSession(service);
    await waitForChrome();

    expect(screen.getByTestId('solve-stub-allow-skip')).toHaveTextContent('false');
  });

  it('shows a missing state when the cycle does not exist', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/puzzles/sets/:setId/cycles/:cycleNumber" element={<CycleSessionPage />} />
      </Routes>,
      { initialEntries: [`/puzzles/sets/${SET_ID}/cycles/9`] },
    );

    await screen.findByTestId('cycle-session-missing');
    expect(screen.getByTestId('cycle-session-back')).toHaveAttribute('href', '/puzzles');
  });

  it('announces progress and exposes labelled Exit/Skip controls', async () => {
    const { service } = await seedCycle();
    renderSession(service);
    await waitForChrome();

    const progress = screen.getByTestId('cycle-session-progress');
    expect(progress).toHaveAttribute('role', 'status');
    expect(progress).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
    // The host passes `allowSkip` to Feature 012's labelled Skip control.
    expect(screen.getByTestId('solve-stub-allow-skip')).toHaveTextContent('true');
  });

  it('exits the cycle from the keyboard without completing it', async () => {
    const { service } = await seedCycle();
    renderSession(service);
    await waitForChrome();

    const user = userEvent.setup();
    screen.getByTestId('cycle-session-exit').focus();
    await user.keyboard('{Enter}');

    await screen.findByTestId('set-detail-stub');
    const cycles = await trainingCyclesRepository.listForSet(SET_ID);
    expect(cycles[0]!.status).toBe('inProgress');
  });

  it('keeps the session chrome reachable on a mobile viewport', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { service } = await seedCycle();
      renderSession(service);
      await waitForChrome();

      expect(screen.getByTestId('cycle-session-chrome')).toBeInTheDocument();
      expect(screen.getByTestId('cycle-session-progress')).toHaveTextContent('Puzzle 1 of 2');
      expect(screen.getByTestId('cycle-session-exit')).toBeVisible();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('renders a Quick train session from the sentinel and completes to training home', async () => {
    const rows = [puzzleFor(6), puzzleFor(8)];
    await puzzlesRepository.addIfAbsent(rows);
    const service = makeService();
    const started = await service.startQuickTrain();
    if (!started.ok) {
      throw new Error('expected the quick-train cycle to start');
    }
    renderQuickTrain(service);
    await waitForChrome();

    expect(screen.getByTestId('cycle-session-set-name')).toHaveTextContent('Quick train');
    expect(screen.getByTestId('cycle-session-progress')).toHaveTextContent('Puzzle 1 of 2');

    fireEvent.click(screen.getByTestId('solve-stub-solve'));
    await waitFor(() =>
      expect(screen.getByTestId('cycle-session-progress')).toHaveTextContent('Puzzle 2 of 2'),
    );
    fireEvent.click(screen.getByTestId('solve-stub-solve'));

    await screen.findByTestId('training-home-stub');
    const cycles = await trainingCyclesRepository.listForSet(QUICK_TRAIN_SET_ID);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.status).toBe('completed');
  });

  it('exits a Quick train session back to training without completing it', async () => {
    await puzzlesRepository.addIfAbsent([puzzleFor(6)]);
    const service = makeService();
    const started = await service.startQuickTrain();
    if (!started.ok) {
      throw new Error('expected the quick-train cycle to start');
    }
    renderQuickTrain(service);
    await waitForChrome();

    fireEvent.click(screen.getByTestId('cycle-session-exit'));

    await screen.findByTestId('training-home-stub');
    const cycles = await trainingCyclesRepository.listForSet(QUICK_TRAIN_SET_ID);
    expect(cycles[0]!.status).toBe('inProgress');
  });

  it('shows a non-blocking spacing nudge for a same-day block restart', async () => {
    const service = await seedBlockWithPreviousCycle(2 * 60 * 60 * 1000);
    renderBlockSession(service);

    const nudge = await screen.findByTestId('cycle-spacing-nudge');
    expect(nudge).toHaveTextContent('Woodpecker block');
    expect(screen.getByTestId('cycle-spacing-nudge-text')).toHaveTextContent('cycle 1');
    expect(screen.getByTestId('cycle-spacing-nudge-text')).toHaveAttribute('aria-live', 'polite');
    // The nudge gates the first presentation until the user proceeds.
    expect(screen.queryByTestId('solve-stub')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cycle-spacing-nudge-start'));
    await screen.findByTestId('solve-stub');
    expect(screen.queryByTestId('cycle-spacing-nudge')).not.toBeInTheDocument();
  });

  it('does not nudge when the previous block cycle ended a day or more ago', async () => {
    const service = await seedBlockWithPreviousCycle(2 * DAY_MS);
    renderBlockSession(service);

    await screen.findByTestId('solve-stub');
    expect(screen.queryByTestId('cycle-spacing-nudge')).not.toBeInTheDocument();
  });

  it('does not nudge for a custom (non-block) set', async () => {
    const rows = [puzzleFor(6)];
    await puzzlesRepository.addIfAbsent(rows);
    await trainingSetsRepository.create(
      setFixture({ id: SET_ID, name: 'Tactics set', puzzleIds: rows.map(idOf) }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-prev',
        trainingSetId: SET_ID,
        cycleNumber: 1,
        status: 'completed',
        startedAt: NOW - 3 * 60 * 60 * 1000,
        completedAt: NOW - 2 * 60 * 60 * 1000,
        puzzleIds: rows.map(idOf),
      }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-current',
        trainingSetId: SET_ID,
        cycleNumber: 2,
        status: 'inProgress',
        startedAt: NOW,
        puzzleIds: rows.map(idOf),
      }),
    );
    renderSession(makeService(), 2);

    await screen.findByTestId('solve-stub');
    expect(screen.queryByTestId('cycle-spacing-nudge')).not.toBeInTheDocument();
  });
});
