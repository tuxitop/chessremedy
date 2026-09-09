import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { Game } from '@/domain/chess/game';
import { puzzleFixtures } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { renderWithProviders } from '@/test/test-utils';
import { PuzzlesPage } from '@/pages/PuzzlesPage';

const { chessboardProps } = vi.hoisted(() => ({
  chessboardProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/chessboard/Chessboard', () => ({
  Chessboard: (props: Record<string, unknown>) => {
    chessboardProps.push(props);
    return null;
  },
}));

const GAME_WITH_MANY = fixtureGame('cc-bullet-blunder'); // user White, matches the White-side rows
const GAME_WITH_ONE = fixtureGame('li-blitz-blunder'); // user Black
const GAME_EMPTY = fixtureGame('cc-rapid-missed-tactic'); // user White, never seeded with puzzles

/** A deterministic fixture row rebased onto `gameId` at `ply`. */
function rowFor(gameId: string, ply: number): PuzzleRow {
  const base =
    ply === 6
      ? puzzleFixtures['mate-one']
      : ply === 8
        ? puzzleFixtures['material-combination']
        : puzzleFixtures['accepted-alternatives'];
  return { ...base, sourceGameId: gameId, sourcePly: ply };
}

async function seedGames(...games: readonly Game[]): Promise<void> {
  for (const game of games) {
    await gamesRepository.saveGame(game);
  }
}

async function seedPuzzles(entries: readonly { readonly gameId: string; readonly ply: number }[]) {
  await puzzlesRepository.addIfAbsent(entries.map(({ gameId, ply }) => rowFor(gameId, ply)));
}

function renderPuzzles(): void {
  renderWithProviders(
    <Routes>
      <Route path="/puzzles" element={<PuzzlesPage />} />
    </Routes>,
    { initialEntries: ['/puzzles'] },
  );
}

function lastBoard(): Record<string, unknown> {
  const last = chessboardProps[chessboardProps.length - 1];
  if (!last) {
    throw new Error('No Chessboard has rendered.');
  }
  return last;
}

async function waitForInteractive(): Promise<void> {
  await waitFor(() => {
    expect(lastBoard().interactive).toBe(true);
  });
}

function boardMove(from: string, to: string): void {
  const props = lastBoard();
  const onMove = props.onMove as ((f: string, t: string) => void) | undefined;
  if (!onMove) {
    throw new Error('Board is not interactive.');
  }
  act(() => onMove(from, to));
}

/** Finish the presented puzzle via the in-list Next control (once written). */
async function clickNext(): Promise<void> {
  const button = await screen.findByTestId('solve-next');
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe('Puzzles page — interim practice host (Feature 012)', () => {
  beforeEach(async () => {
    chessboardProps.length = 0;
    await db.games.clear();
    await db.puzzles.clear();
    await db.puzzleAttempts.clear();
    await db.settings.clear();
  });

  it('shows an honest empty state pointing at the Game Library when no game has puzzles', async () => {
    await seedGames(GAME_EMPTY);
    renderPuzzles();

    const empty = await screen.findByTestId('puzzles-practice-empty');
    expect(empty).toHaveTextContent('No practice puzzles yet');
    expect(empty).toHaveTextContent('Generate puzzles');
    const link = within(empty).getByTestId('puzzles-practice-to-games');
    expect(link).toHaveAttribute('href', '/games');
    expect(screen.queryByTestId('puzzles-practice-list')).not.toBeInTheDocument();
    expect(screen.queryByText('0 puzzles')).not.toBeInTheDocument();
  });

  it('lists only the games that own puzzle rows, with truthful counts and a practise action', async () => {
    await seedGames(GAME_WITH_MANY, GAME_WITH_ONE, GAME_EMPTY);
    await seedPuzzles([
      { gameId: GAME_WITH_MANY.id, ply: 6 },
      { gameId: GAME_WITH_MANY.id, ply: 20 },
      { gameId: GAME_WITH_ONE.id, ply: 8 },
    ]);
    renderPuzzles();

    const many = await screen.findByTestId(`puzzles-practice-game-${GAME_WITH_MANY.id}`);
    expect(many).toHaveTextContent('chessremedy vs bulletpete');
    expect(many).toHaveTextContent('2 puzzles');
    expect(within(many).getByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`)).toBeVisible();

    const one = screen.getByTestId(`puzzles-practice-game-${GAME_WITH_ONE.id}`);
    expect(one).toHaveTextContent('blitzbella vs chessremedy');
    expect(one).toHaveTextContent('1 puzzle');
    expect(within(one).getByTestId(`puzzles-practice-choose-${GAME_WITH_ONE.id}`)).toBeVisible();

    // The stored game without puzzle rows is never listed (absent ≠ zero).
    expect(screen.queryByTestId(`puzzles-practice-game-${GAME_EMPTY.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-practice-empty')).not.toBeInTheDocument();
  });

  it('selecting a game starts a session that renders and solves every puzzle in order, then completes — writing no attempt rows', async () => {
    await seedGames(GAME_WITH_MANY);
    await seedPuzzles([
      { gameId: GAME_WITH_MANY.id, ply: 6 }, // mate-one: 1.h5f7
      { gameId: GAME_WITH_MANY.id, ply: 20 }, // accepted-alternatives: 1.g5e6 (terminal)
    ]);
    renderPuzzles();

    fireEvent.click(await screen.findByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`));

    // The session starts on the first puzzle in sourcePly order with progress.
    expect(await screen.findByTestId('solve-objective')).toHaveTextContent('Forced mate');
    expect(screen.getByTestId('puzzles-practice-progress')).toHaveTextContent('Puzzle 1 of 2');
    expect(screen.getByTestId('puzzles-practice-game-label')).toHaveTextContent(
      'chessremedy vs bulletpete',
    );
    await waitForInteractive();
    expect(lastBoard().orientation).toBe('white');
    expect(screen.queryByTestId('solve-clock')).not.toBeInTheDocument();

    boardMove('h5', 'f7');
    await clickNext();

    // Solving advanced to the second puzzle.
    expect(await screen.findByTestId('puzzles-practice-progress')).toHaveTextContent(
      'Puzzle 2 of 2',
    );
    expect(screen.getByTestId('solve-objective')).toHaveTextContent('Winning material');

    await waitForInteractive();
    boardMove('g5', 'e6');
    await clickNext();

    const complete = await screen.findByTestId('puzzles-practice-complete');
    expect(complete).toHaveTextContent('Practice complete');
    expect(complete).toHaveTextContent('practice attempts only');
    expect(complete).toHaveTextContent('Feature 013');
    expect(screen.getByTestId('puzzles-practice-again')).toBeVisible();
    expect(screen.getByTestId('puzzles-practice-exit')).toBeVisible();

    // Practice never writes to the real attempts table.
    expect(await db.puzzleAttempts.count()).toBe(0);
  });

  it('a wrong-then-correct solve is accepted and hints never fail the puzzle through the hosted SolveScreen', async () => {
    await seedGames(GAME_WITH_MANY);
    await seedPuzzles([{ gameId: GAME_WITH_MANY.id, ply: 6 }]);
    renderPuzzles();

    fireEvent.click(await screen.findByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`));
    await screen.findByTestId('solve-objective');
    await waitForInteractive();

    fireEvent.click(screen.getByTestId('solve-hint'));
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent('Relevant piece: queen');

    boardMove('d2', 'd3');
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent(
      'not the move that achieves',
    );

    boardMove('h5', 'f7');
    await waitFor(() =>
      expect(screen.getByTestId('solve-result')).toHaveTextContent('Solved with hints'),
    );
    await clickNext();
    expect(await screen.findByTestId('puzzles-practice-complete')).toBeInTheDocument();
    expect(await db.puzzleAttempts.count()).toBe(0);
  });

  it('shows the solve clock in a session when the Show puzzle timer setting is on', async () => {
    await settingsRepository.set(SETTINGS_KEYS.puzzleTimer, true);
    await seedGames(GAME_WITH_MANY);
    await seedPuzzles([{ gameId: GAME_WITH_MANY.id, ply: 6 }]);
    renderPuzzles();

    fireEvent.click(await screen.findByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`));
    await screen.findByTestId('solve-objective');
    await waitForInteractive();
    expect(screen.getByTestId('solve-clock')).toBeInTheDocument();
  });

  it('End practice discards the session and returns to the picker without persisting', async () => {
    await seedGames(GAME_WITH_MANY);
    await seedPuzzles([{ gameId: GAME_WITH_MANY.id, ply: 6 }]);
    renderPuzzles();

    fireEvent.click(await screen.findByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`));
    await screen.findByTestId('solve-objective');
    await waitForInteractive();

    fireEvent.click(screen.getByTestId('puzzles-practice-exit'));

    expect(
      await screen.findByTestId(`puzzles-practice-game-${GAME_WITH_MANY.id}`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('solve-screen')).not.toBeInTheDocument();
    expect(await db.puzzleAttempts.count()).toBe(0);
  });

  it('can re-enter a fresh session from the completion state', async () => {
    await seedGames(GAME_WITH_MANY);
    await seedPuzzles([
      { gameId: GAME_WITH_MANY.id, ply: 6 },
      { gameId: GAME_WITH_MANY.id, ply: 20 },
    ]);
    renderPuzzles();

    fireEvent.click(await screen.findByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`));
    await screen.findByTestId('solve-objective');
    await waitForInteractive();
    boardMove('h5', 'f7');
    await clickNext();
    await waitFor(() =>
      expect(screen.getByTestId('puzzles-practice-progress')).toHaveTextContent('Puzzle 2 of 2'),
    );
    await waitForInteractive();
    boardMove('g5', 'e6');
    await clickNext();

    fireEvent.click(await screen.findByTestId('puzzles-practice-again'));

    expect(await screen.findByTestId('puzzles-practice-progress')).toHaveTextContent(
      'Puzzle 1 of 2',
    );
    expect(screen.getByTestId('solve-objective')).toHaveTextContent('Forced mate');
    expect(await db.puzzleAttempts.count()).toBe(0);
  });
});
