import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { Game } from '@/domain/chess/game';
import { puzzleFixtures } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
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

/** Pointer-free solve of the currently presented puzzle through the text path. */
function typeAndPlayMove(text: string): void {
  fireEvent.change(screen.getByLabelText('Enter a move'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('puzzle-move-submit'));
}

/** Continue from an outcome screen back to the host once the row is written. */
async function continueFromOutcome(): Promise<void> {
  const panel = await screen.findByTestId('outcome-panel');
  const button = within(panel).getByTestId('outcome-continue');
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe('Puzzles page — interim practice host (Feature 012)', () => {
  beforeEach(async () => {
    chessboardProps.length = 0;
    await db.games.clear();
    await db.puzzles.clear();
    await db.puzzleAttempts.clear();
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
    expect(screen.getByTestId('solve-side-to-move')).toHaveTextContent('White to move');
    expect(screen.getByTestId('puzzles-practice-progress')).toHaveTextContent('Puzzle 1 of 2');
    expect(screen.getByTestId('puzzles-practice-game-label')).toHaveTextContent(
      'chessremedy vs bulletpete',
    );
    const firstBoard = chessboardProps[chessboardProps.length - 1];
    expect(firstBoard?.orientation).toBe('white');
    expect(firstBoard?.interactive).toBe(true);

    typeAndPlayMove('h5f7');
    await continueFromOutcome();

    // Solving advanced to the second puzzle.
    expect(await screen.findByTestId('puzzles-practice-progress')).toHaveTextContent(
      'Puzzle 2 of 2',
    );
    expect(screen.getByTestId('solve-objective')).toHaveTextContent('Winning material');

    typeAndPlayMove('g5e6');
    await continueFromOutcome();

    const complete = await screen.findByTestId('puzzles-practice-complete');
    expect(complete).toHaveTextContent('Practice complete');
    expect(complete).toHaveTextContent('practice attempts only');
    expect(complete).toHaveTextContent('Feature 013');
    expect(screen.getByTestId('puzzles-practice-again')).toBeVisible();
    expect(screen.getByTestId('puzzles-practice-exit')).toBeVisible();

    // Practice never writes to the real attempts table.
    expect(await db.puzzleAttempts.count()).toBe(0);
  });

  it('a wrong-then-correct solve is accepted and a hint press works through the hosted SolveScreen', async () => {
    await seedGames(GAME_WITH_MANY);
    await seedPuzzles([{ gameId: GAME_WITH_MANY.id, ply: 6 }]);
    renderPuzzles();

    fireEvent.click(await screen.findByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`));
    await screen.findByTestId('solve-objective');

    fireEvent.click(screen.getByTestId('solve-hint'));
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent('Relevant piece: queen');

    typeAndPlayMove('d2d3');
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent(
      'not the move that achieves',
    );
    expect(screen.getByTestId('solve-wrong-count')).toHaveTextContent('Wrong moves: 1');

    typeAndPlayMove('h5f7');
    const panel = await screen.findByTestId('outcome-panel');
    expect(within(panel).getByTestId('outcome-result')).toHaveTextContent('Solved with help');
    const continueButton = within(panel).getByTestId('outcome-continue');
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);
    expect(await screen.findByTestId('puzzles-practice-complete')).toBeInTheDocument();
    expect(await db.puzzleAttempts.count()).toBe(0);
  });

  it('End practice discards the session and returns to the picker without persisting', async () => {
    await seedGames(GAME_WITH_MANY);
    await seedPuzzles([{ gameId: GAME_WITH_MANY.id, ply: 6 }]);
    renderPuzzles();

    fireEvent.click(await screen.findByTestId(`puzzles-practice-choose-${GAME_WITH_MANY.id}`));
    await screen.findByTestId('solve-objective');

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
    typeAndPlayMove('h5f7');
    await continueFromOutcome();
    await waitFor(() =>
      expect(screen.getByTestId('puzzles-practice-progress')).toHaveTextContent('Puzzle 2 of 2'),
    );
    typeAndPlayMove('g5e6');
    await continueFromOutcome();

    fireEvent.click(await screen.findByTestId('puzzles-practice-again'));

    expect(await screen.findByTestId('puzzles-practice-progress')).toHaveTextContent(
      'Puzzle 1 of 2',
    );
    expect(screen.getByTestId('solve-objective')).toHaveTextContent('Forced mate');
    expect(await db.puzzleAttempts.count()).toBe(0);
  });
});
