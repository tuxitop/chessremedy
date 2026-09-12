import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { MasteredPuzzlesPage } from '@/pages/MasteredPuzzlesPage';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle';
import { cycleFixture, legitimateFirstTryRows } from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

const GAME = 'game:mastery';

function rowFor(ply: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: GAME, sourcePly: ply };
}

function idFor(row: PuzzleRow): string {
  return puzzleIdOf(row.sourceGameId, row.sourcePly);
}

async function masterPuzzle(puzzleId: string): Promise<void> {
  const cycleIds = ['c1', 'c2', 'c3'];
  for (const [index, cycleId] of cycleIds.entries()) {
    await trainingCyclesRepository.create(
      cycleFixture({ id: cycleId, cycleNumber: index + 1, puzzleIds: [puzzleId] }),
    );
  }
  for (const row of legitimateFirstTryRows(puzzleId, cycleIds)) {
    await attemptsRepository.addAttempt(row);
  }
}

function renderPage(): void {
  renderWithProviders(
    <Routes>
      <Route path="/training/mastered" element={<MasteredPuzzlesPage />} />
      <Route path="/training" element={<div data-testid="training-home-stub" />} />
    </Routes>,
    { initialEntries: ['/training/mastered'] },
  );
}

async function waitForLoaded(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId('mastered-puzzles-loading')).toBeNull());
}

describe('MasteredPuzzlesPage', () => {
  it('shows an explicit empty state with the mastery rule and a back link', async () => {
    renderPage();
    await waitForLoaded();

    const empty = screen.getByTestId('mastered-puzzles-empty');
    expect(empty).toHaveTextContent(/No mastered puzzles yet/i);
    expect(empty).toHaveTextContent(/3 different cycles/i);
    expect(screen.getByTestId('mastered-puzzles-back')).toHaveAttribute('href', '/training');
    expect(screen.queryByTestId('mastered-puzzles-list')).not.toBeInTheDocument();
  });

  it('lists only mastered puzzles with provenance, objective, difficulty and the source link', async () => {
    const mastered = rowFor(6);
    const unmastered = rowFor(8);
    await puzzlesRepository.addIfAbsent([mastered, unmastered]);
    await masterPuzzle(idFor(mastered));

    renderPage();
    await waitForLoaded();

    const id = idFor(mastered);
    const item = screen.getByTestId(`mastered-puzzle-${id}`);
    expect(within(item).getByTestId(`mastered-puzzle-provenance-${id}`)).toHaveTextContent(
      `${GAME} · ply 6`,
    );
    expect(within(item).getByTestId(`mastered-puzzle-objective-${id}`)).toHaveTextContent(
      'Forced mate',
    );
    expect(within(item).getByTestId(`mastered-puzzle-difficulty-${id}`)).toHaveTextContent(
      'Trivial · 12',
    );
    expect(within(item).getByTestId(`mastered-puzzle-cycles-${id}`)).toHaveTextContent(
      '3 distinct cycles',
    );
    expect(within(item).getByTestId(`mastered-puzzle-game-link-${id}`)).toHaveAttribute(
      'href',
      `/games/${encodeURIComponent(GAME)}/puzzles`,
    );

    // The unmastered puzzle is absent, and there is no un-master action.
    expect(screen.queryByTestId(`mastered-puzzle-${idFor(unmastered)}`)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /un-?master/i })).not.toBeInTheDocument();
  });
});
