import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { TrainingHomePage, type TrainingHomePageProps } from '@/pages/TrainingHomePage';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle';
import { QUICK_TRAIN_SET_ID } from '@/domain/training';
import type { TrainingSetsService } from '@/infrastructure/training';
import {
  blockSetFixture,
  cycleFixture,
  legitimateFirstTryRows,
  setFixture,
} from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

const NOW = 1_700_000_000_000;

function renderHome(props: Partial<TrainingHomePageProps> = {}): void {
  renderWithProviders(
    <Routes>
      <Route path="/puzzles" element={<TrainingHomePage {...props} />} />
      <Route path="/puzzles/sets/:setId" element={<div data-testid="set-detail-stub" />} />
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber"
        element={<div data-testid="cycle-session-stub" />}
      />
    </Routes>,
    { initialEntries: ['/puzzles'] },
  );
}

async function waitForHome(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId('training-home-loading')).toBeNull());
}

/** A deterministic pool puzzle at `ply`. */
function poolPuzzle(ply: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: 'game:home', sourcePly: ply };
}

/** Write a legitimate first-try solve for `puzzleId` in 3 distinct cycles. */
async function masterPuzzle(puzzleId: string): Promise<void> {
  for (const row of legitimateFirstTryRows(puzzleId, ['c1', 'c2', 'c3'])) {
    await attemptsRepository.addAttempt(row);
  }
}

describe('TrainingHomePage', () => {
  it('shows an explicit empty state linking to the Game Library when no puzzles exist', async () => {
    renderHome();
    await waitForHome();

    expect(screen.getByTestId('training-home-empty')).toBeInTheDocument();
    expect(screen.getByText(/Puzzles must first be generated/i)).toBeInTheDocument();
    expect(screen.getByTestId('training-home-empty-games-link')).toHaveAttribute('href', '/games');
  });

  it('shows the live pool count, guidance copy and the one-click create action', async () => {
    await puzzlesRepository.addIfAbsent([poolPuzzle(6), poolPuzzle(8), poolPuzzle(10)]);
    renderHome();
    await waitForHome();

    expect(screen.getByTestId('training-pool-count')).toHaveTextContent('3 puzzles ready to train');
    expect(screen.getByTestId('training-pool-guidance')).toHaveTextContent(/fixed once created/i);
    expect(screen.getByTestId('training-pool-guidance')).toHaveTextContent(/200–400/i);
    expect(screen.getByTestId('training-block-create')).toBeEnabled();
    expect(screen.getByTestId('training-quick-train')).toBeEnabled();
    // The size selector lives behind the Advanced disclosure and defaults to 200.
    expect(screen.getByTestId('training-block-advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('training-block-size')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('training-block-advanced-toggle'));
    expect(screen.getByTestId('training-block-size')).toHaveValue('200');
  });

  it('creates a Woodpecker block and navigates to its detail', async () => {
    await puzzlesRepository.addIfAbsent([poolPuzzle(6), poolPuzzle(8)]);
    renderHome();
    await waitForHome();

    fireEvent.click(screen.getByTestId('training-block-create'));

    await screen.findByTestId('set-detail-stub');
    const block = await trainingSetsRepository.getOpenBlock();
    expect(block).toBeDefined();
    expect(block?.puzzleIds).toHaveLength(2);
    expect(block?.source).toEqual({ kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: 200 } });
  });

  it('honours the Advanced block size when creating', async () => {
    await puzzlesRepository.addIfAbsent([poolPuzzle(6), poolPuzzle(8)]);
    renderHome();
    await waitForHome();

    fireEvent.click(screen.getByTestId('training-block-advanced-toggle'));
    fireEvent.change(screen.getByTestId('training-block-size'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('training-block-create'));

    await screen.findByTestId('set-detail-stub');
    const block = await trainingSetsRepository.getOpenBlock();
    expect(block?.source).toEqual({ kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: 100 } });
  });

  it('shows the open block as a badged card and hides the create action', async () => {
    const [first, second] = [poolPuzzle(6), poolPuzzle(8)];
    await puzzlesRepository.addIfAbsent([first, second]);
    await trainingSetsRepository.create(
      blockSetFixture({
        id: 'block-1',
        name: 'Woodpecker block',
        puzzleIds: [puzzleIdOf(first.sourceGameId, first.sourcePly)],
      }),
    );
    renderHome();
    await waitForHome();

    const card = screen.getByTestId('set-card-block-1');
    expect(within(card).getByTestId('set-card-badge-block-1')).toHaveTextContent(
      'Woodpecker block',
    );
    expect(screen.getByTestId('set-card-block-size-block-1')).toHaveTextContent('200 puzzles');
    expect(screen.getByTestId('training-block-open-note')).toHaveTextContent(/already|open/i);
    expect(screen.queryByTestId('training-block-create')).not.toBeInTheDocument();
    // Quick train still trains the remaining pool.
    expect(screen.getByTestId('training-quick-train')).toBeEnabled();
    expect(screen.getByTestId('training-pool-count')).toHaveTextContent('1 puzzle ready to train');
  });

  it('surfaces a block-open refusal without crashing', async () => {
    await puzzlesRepository.addIfAbsent([poolPuzzle(6)]);
    const fakeSets = {
      list: async () => [],
      getOpenBlock: async () => undefined,
      createWoodpeckerBlock: async () => ({
        ok: false,
        reason: 'block-open',
        block: blockSetFixture({ id: 'other' }),
      }),
    } as unknown as TrainingSetsService;
    renderHome({ setsService: fakeSets });
    await waitForHome();

    fireEvent.click(screen.getByTestId('training-block-create'));

    await waitFor(() =>
      expect(screen.getByTestId('training-block-notice')).toHaveTextContent(/already open/i),
    );
  });

  it('surfaces an empty-pool refusal without crashing', async () => {
    await puzzlesRepository.addIfAbsent([poolPuzzle(6)]);
    const fakeSets = {
      list: async () => [],
      getOpenBlock: async () => undefined,
      createWoodpeckerBlock: async () => ({ ok: false, reason: 'empty-pool' }),
    } as unknown as TrainingSetsService;
    renderHome({ setsService: fakeSets });
    await waitForHome();

    fireEvent.click(screen.getByTestId('training-block-create'));

    await waitFor(() =>
      expect(screen.getByTestId('training-block-notice')).toHaveTextContent(/empty/i),
    );
  });

  it('starts Quick train and navigates into the sentinel session', async () => {
    await puzzlesRepository.addIfAbsent([poolPuzzle(6), poolPuzzle(8)]);
    renderHome();
    await waitForHome();

    fireEvent.click(screen.getByTestId('training-quick-train'));

    await screen.findByTestId('cycle-session-stub');
    const cycles = await trainingCyclesRepository.listForSet(QUICK_TRAIN_SET_ID);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.trainingSetId).toBe(QUICK_TRAIN_SET_ID);
    expect(cycles[0]!.status).toBe('inProgress');
  });

  it('renders active custom sets as cards with count, current cycle and last activity', async () => {
    await trainingSetsRepository.create(
      setFixture({
        id: 'set-a',
        name: 'Opening drills',
        puzzleIds: ['g:1', 'g:2', 'g:3'],
        updatedAt: NOW - 5_000,
      }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-a',
        trainingSetId: 'set-a',
        cycleNumber: 2,
        status: 'inProgress',
        startedAt: NOW,
      }),
    );

    renderHome();
    await waitForHome();

    const card = screen.getByTestId('set-card-set-a');
    expect(card).toHaveTextContent('Opening drills');
    expect(screen.getByTestId('set-card-count-set-a')).toHaveTextContent('3 puzzles');
    expect(screen.getByTestId('set-card-cycle-set-a')).toHaveTextContent('Cycle 2 · In progress');
    expect(screen.getByTestId('set-card-open-set-a')).toHaveAttribute(
      'href',
      '/puzzles/sets/set-a',
    );
    // A custom set is not badged as a block.
    expect(screen.queryByTestId('set-card-badge-set-a')).not.toBeInTheDocument();
  });

  it('never renders a bare zero for absent data', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-empty', name: 'Empty set', puzzleIds: [] }),
    );
    await puzzlesRepository.addIfAbsent([poolPuzzle(6)]);

    renderHome();
    await waitForHome();

    expect(screen.getByTestId('set-card-count-set-empty')).toHaveTextContent('No puzzles yet');
    expect(screen.getByTestId('set-card-cycle-set-empty')).toHaveTextContent('No cycles yet');
    expect(screen.getByTestId('set-card-count-set-empty')).not.toHaveTextContent('0');
  });

  it('surfaces a resume banner for an in-progress cycle linking to the session', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-b', name: 'Tactics', puzzleIds: ['g:4'] }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-b',
        trainingSetId: 'set-b',
        cycleNumber: 3,
        status: 'inProgress',
        startedAt: NOW,
      }),
    );

    renderHome();
    await waitForHome();

    expect(screen.getByTestId('training-resume')).toBeInTheDocument();
    expect(screen.getByTestId('training-resume-link')).toHaveAttribute(
      'href',
      '/puzzles/sets/set-b/cycles/3',
    );
  });

  it('keeps archived sets behind an affordance until expanded', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-archived', name: 'Old set', status: 'archived', puzzleIds: ['g:9'] }),
    );
    await puzzlesRepository.addIfAbsent([poolPuzzle(6)]);

    renderHome();
    await waitForHome();

    expect(screen.getByTestId('training-archived')).toBeInTheDocument();
    expect(screen.queryByTestId('set-card-set-archived')).toBeNull();

    fireEvent.click(screen.getByTestId('training-archived-toggle'));

    expect(screen.getByTestId('set-card-set-archived')).toBeInTheDocument();
    expect(screen.getByTestId('training-archived-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a closed Woodpecker block reachable behind the archived affordance', async () => {
    await puzzlesRepository.addIfAbsent([poolPuzzle(6)]);
    await trainingSetsRepository.create(
      blockSetFixture({
        id: 'block-closed',
        name: 'Woodpecker block',
        status: 'archived',
        puzzleIds: [puzzleIdOf('game:home', 6)],
      }),
    );

    renderHome();
    await waitForHome();

    expect(screen.queryByTestId('set-card-block-closed')).toBeNull();
    fireEvent.click(screen.getByTestId('training-archived-toggle'));
    const card = screen.getByTestId('set-card-block-closed');
    expect(within(card).getByTestId('set-card-badge-block-closed')).toHaveTextContent(
      'Woodpecker block',
    );
  });

  it('states a fully-mastered pool honestly and disables the actions', async () => {
    const only = poolPuzzle(6);
    await puzzlesRepository.addIfAbsent([only]);
    await masterPuzzle(puzzleIdOf(only.sourceGameId, only.sourcePly));

    renderHome();
    await waitForHome();

    expect(screen.getByTestId('training-pool-count')).toHaveTextContent(/mastered/i);
    expect(screen.getByTestId('training-block-create')).toBeDisabled();
    expect(screen.getByTestId('training-quick-train')).toBeDisabled();
  });

  it('serves /puzzles with the training home, not the removed interim practice host', async () => {
    renderHome();
    await waitForHome();

    expect(screen.getByTestId('training-home')).toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-practice-progress')).not.toBeInTheDocument();
  });

  it('links to the read-only mastered puzzles list and labels every action', async () => {
    renderHome();
    await waitForHome();

    expect(screen.getByTestId('training-mastered-link')).toHaveAttribute(
      'href',
      '/puzzles/mastered',
    );
    expect(screen.getByTestId('training-mastered-link')).toHaveAccessibleName('Mastered puzzles');
    expect(screen.getByTestId('training-new-set')).toHaveAccessibleName('New set');
  });
});
