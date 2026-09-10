import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { SetDetailPage } from '@/pages/SetDetailPage';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { puzzleFixtures } from '@/domain/puzzle/test-support';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle';
import {
  blockSetFixture,
  cycleAttemptFixture,
  cycleFixture,
  setFixture,
} from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

const GAME = fixtureGame('cc-bullet-blunder');
const SET_ID = 'set-1';
const BLOCK_ID = 'block-1';
const PUZZLE_IDS = [puzzleIdOf(GAME.id, 6), puzzleIdOf(GAME.id, 12)];

function puzzleRow(ply: number, kind: 'mate-one' | 'exchange-win'): PuzzleRow {
  return { ...puzzleFixtures[kind], sourceGameId: GAME.id, sourcePly: ply };
}

async function seedSet(): Promise<void> {
  await gamesRepository.saveGame(GAME);
  await puzzlesRepository.addIfAbsent([puzzleRow(6, 'mate-one'), puzzleRow(12, 'exchange-win')]);
  await trainingSetsRepository.create(
    setFixture({ id: SET_ID, name: 'Tactics set', puzzleIds: PUZZLE_IDS }),
  );
}

async function seedBlock(): Promise<void> {
  await gamesRepository.saveGame(GAME);
  await puzzlesRepository.addIfAbsent([puzzleRow(6, 'mate-one'), puzzleRow(12, 'exchange-win')]);
  await trainingSetsRepository.create(
    blockSetFixture({ id: BLOCK_ID, name: 'Woodpecker block', puzzleIds: PUZZLE_IDS }),
  );
}

function renderDetail(setId: string = SET_ID): void {
  renderWithProviders(
    <Routes>
      <Route path="/puzzles/sets/:setId" element={<SetDetailPage />} />
      <Route path="/puzzles" element={<div data-testid="training-home-stub" />} />
      <Route
        path="/puzzles/sets/:setId/cycles/:cycleNumber"
        element={<div data-testid="cycle-session-stub" />}
      />
    </Routes>,
    { initialEntries: [`/puzzles/sets/${setId}`] },
  );
}

async function waitForDetail(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('set-detail-name')).toBeInTheDocument());
}

describe('SetDetailPage', () => {
  it('shows membership and cycle history for a custom set', async () => {
    await seedSet();
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-1',
        trainingSetId: SET_ID,
        cycleNumber: 1,
        status: 'completed',
        puzzleIds: PUZZLE_IDS,
      }),
    );

    renderDetail();
    await waitForDetail();

    expect(screen.getByTestId('set-detail-name')).toHaveTextContent('Tactics set');
    expect(screen.getByTestId('set-detail-membership-count')).toHaveTextContent('2 puzzles');
    expect(screen.getByTestId('set-detail-history-status-1')).toHaveTextContent('Completed');
  });

  it('renames the set', async () => {
    await seedSet();
    renderDetail();
    await waitForDetail();

    fireEvent.change(screen.getByTestId('set-detail-name-input'), {
      target: { value: 'Renamed set' },
    });
    fireEvent.click(screen.getByTestId('set-detail-save-name'));

    await waitFor(async () => {
      const stored = await trainingSetsRepository.get(SET_ID);
      expect(stored?.name).toBe('Renamed set');
    });
  });

  it('saves an edited cycle configuration', async () => {
    await seedSet();
    renderDetail();
    await waitForDetail();

    fireEvent.change(screen.getByTestId('set-detail-retry'), { target: { value: 'none' } });
    fireEvent.click(screen.getByTestId('set-detail-save-config'));

    await waitFor(async () => {
      const stored = await trainingSetsRepository.get(SET_ID);
      expect(stored?.config.retryFailed).toBe('none');
    });
  });

  it('archives and unarchives the set', async () => {
    await seedSet();
    renderDetail();
    await waitForDetail();

    fireEvent.click(screen.getByTestId('set-detail-archive'));
    await waitFor(async () => {
      expect((await trainingSetsRepository.get(SET_ID))?.status).toBe('archived');
    });
    await waitFor(() =>
      expect(screen.getByTestId('set-detail-archive')).toHaveTextContent('Unarchive set'),
    );

    fireEvent.click(screen.getByTestId('set-detail-archive'));
    await waitFor(async () => {
      expect((await trainingSetsRepository.get(SET_ID))?.status).toBe('active');
    });
  });

  it('confirms deletion naming the set and its cycle/attempt counts', async () => {
    await seedSet();
    await trainingCyclesRepository.create(
      cycleFixture({ id: 'cycle-1', trainingSetId: SET_ID, cycleNumber: 1, status: 'completed' }),
    );
    await attemptsRepository.addAttempt(
      cycleAttemptFixture({ cycleId: 'cycle-1', trainingSetId: SET_ID, puzzleId: PUZZLE_IDS[0]! }),
    );

    renderDetail();
    await waitForDetail();

    fireEvent.click(screen.getByTestId('set-detail-delete'));
    const dialog = screen.getByTestId('set-detail-delete-dialog');
    expect(dialog).toHaveTextContent('Delete “Tactics set”?');
    expect(screen.getByTestId('set-detail-delete-dialog-details')).toHaveTextContent('1 cycle');
    expect(screen.getByTestId('set-detail-delete-dialog-details')).toHaveTextContent(
      '1 recorded attempt',
    );

    fireEvent.click(screen.getByTestId('set-detail-delete-dialog-confirm'));
    await screen.findByTestId('training-home-stub');
    expect(await trainingSetsRepository.get(SET_ID)).toBeUndefined();
  });

  it('starts a cycle and opens the session', async () => {
    await seedSet();
    renderDetail();
    await waitForDetail();

    fireEvent.click(screen.getByTestId('set-detail-start-cycle'));

    await screen.findByTestId('cycle-session-stub');
    const cycles = await trainingCyclesRepository.listForSet(SET_ID);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.cycleNumber).toBe(1);
    expect(cycles[0]!.status).toBe('inProgress');
  });

  it('blocks starting a cycle on an empty set and explains why', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: SET_ID, name: 'Empty set', puzzleIds: [] }),
    );
    renderDetail();
    await waitForDetail();

    expect(screen.getByTestId('set-detail-empty')).toBeInTheDocument();
    expect(screen.getByTestId('set-detail-start-cycle')).toBeDisabled();
    expect(await trainingCyclesRepository.listForSet(SET_ID)).toHaveLength(0);
  });

  it('cancels the delete confirmation from the keyboard without deleting', async () => {
    await seedSet();
    renderDetail();
    await waitForDetail();

    fireEvent.click(screen.getByTestId('set-detail-delete'));
    expect(screen.getByTestId('set-detail-delete-dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByTestId('set-detail-delete-dialog')).not.toBeInTheDocument(),
    );
    expect(await trainingSetsRepository.get(SET_ID)).toBeDefined();
  });

  it('renders a block read-only with its recipe, fixed membership and close actions', async () => {
    await seedBlock();
    renderDetail(BLOCK_ID);
    await waitForDetail();

    expect(screen.getByTestId('set-detail-block-badge')).toHaveTextContent('Woodpecker block');
    expect(screen.getByTestId('set-detail-block-note')).toHaveTextContent(/fixed/i);
    expect(screen.getByTestId('set-detail-block-recipe')).toHaveTextContent('Block size: 200');
    expect(screen.getByTestId('set-detail-block-guidance')).toHaveTextContent(/200–400/);
    expect(screen.getByTestId('set-detail-membership-count')).toHaveTextContent(
      '2 puzzles in this block (fixed)',
    );

    // No rename, config editing, archive or delete for a block.
    expect(screen.queryByTestId('set-detail-name-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('set-detail-save-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('set-detail-save-config')).not.toBeInTheDocument();
    expect(screen.queryByTestId('set-detail-archive')).not.toBeInTheDocument();
    expect(screen.queryByTestId('set-detail-delete')).not.toBeInTheDocument();

    // Finish/Abandon and starting a cycle are available.
    expect(screen.getByTestId('set-detail-finish-block')).toBeInTheDocument();
    expect(screen.getByTestId('set-detail-abandon-block')).toBeInTheDocument();
    expect(screen.getByTestId('set-detail-start-cycle')).toBeEnabled();
  });

  it('finishes a block after a confirmation naming it and closes it', async () => {
    await seedBlock();
    renderDetail(BLOCK_ID);
    await waitForDetail();

    fireEvent.click(screen.getByTestId('set-detail-finish-block'));
    const dialog = screen.getByTestId('set-detail-close-dialog');
    expect(dialog).toHaveTextContent('Finish “Woodpecker block”?');
    fireEvent.click(screen.getByTestId('set-detail-close-dialog-confirm'));

    await waitFor(async () => {
      expect((await trainingSetsRepository.get(BLOCK_ID))?.status).toBe('archived');
    });
    await screen.findByTestId('set-detail-block-closed');
    expect(screen.queryByTestId('set-detail-finish-block')).not.toBeInTheDocument();
  });

  it('abandons a block after a confirmation naming it and closes it', async () => {
    await seedBlock();
    renderDetail(BLOCK_ID);
    await waitForDetail();

    fireEvent.click(screen.getByTestId('set-detail-abandon-block'));
    expect(screen.getByTestId('set-detail-close-dialog')).toHaveTextContent(
      'Abandon “Woodpecker block”?',
    );
    fireEvent.click(screen.getByTestId('set-detail-close-dialog-confirm'));

    await waitFor(async () => {
      expect((await trainingSetsRepository.get(BLOCK_ID))?.status).toBe('archived');
    });
    await screen.findByTestId('set-detail-block-closed');
  });

  it('starts a cycle on a block and opens the session', async () => {
    await seedBlock();
    renderDetail(BLOCK_ID);
    await waitForDetail();

    fireEvent.click(screen.getByTestId('set-detail-start-cycle'));

    await screen.findByTestId('cycle-session-stub');
    const cycles = await trainingCyclesRepository.listForSet(BLOCK_ID);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.status).toBe('inProgress');
  });
});
