import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { SetEditorPage } from '@/pages/SetEditorPage';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { fixtureGame } from '@/domain/chess/fixtures';
import { puzzleFixtures, blunderPuzzleFixtures } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle';
import { setFixture } from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

const GAME = fixtureGame('cc-bullet-blunder');

function rowFor(ply: number, kind: 'mate-one' | 'exchange-win' | 'blunder'): PuzzleRow {
  if (kind === 'blunder') {
    return { ...blunderPuzzleFixtures['correct-move'], sourceGameId: GAME.id, sourcePly: ply };
  }
  return { ...puzzleFixtures[kind], sourceGameId: GAME.id, sourcePly: ply };
}

async function seedData(): Promise<void> {
  await gamesRepository.saveGame(GAME);
  await puzzlesRepository.addIfAbsent([
    rowFor(6, 'mate-one'),
    rowFor(8, 'blunder'),
    rowFor(12, 'exchange-win'),
  ]);
}

function renderEditor(entry: string): void {
  renderWithProviders(
    <Routes>
      <Route path="/training/new" element={<SetEditorPage />} />
      <Route path="/training/sets/:setId" element={<div data-testid="navigated-set" />} />
    </Routes>,
    { initialEntries: [entry] },
  );
}

async function waitForLoaded(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('set-editor-save')).not.toBeDisabled());
}

describe('SetEditorPage', () => {
  it('creates a set from a game and shows the membership before committing', async () => {
    await seedData();
    renderEditor(`/training/new?source=game&gameId=${GAME.id}`);
    await waitForLoaded();

    expect(screen.getByTestId('set-editor-preview-count')).toHaveTextContent('3 puzzles');
    expect(screen.getByTestId('set-editor-membership')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('set-editor-name'), { target: { value: 'Game set' } });
    fireEvent.click(screen.getByTestId('set-editor-save'));

    await screen.findByTestId('navigated-set');
    const sets = await trainingSetsRepository.list({ status: 'active' });
    expect(sets).toHaveLength(1);
    expect(sets[0]!.name).toBe('Game set');
    expect(sets[0]!.puzzleIds).toHaveLength(3);
    expect(sets[0]!.source).toEqual({ kind: 'game', gameId: GAME.id });
  });

  it('applies pool filters and target size to the preview', async () => {
    await seedData();
    renderEditor('/training/new');
    await waitForLoaded();

    expect(screen.getByTestId('set-editor-preview-count')).toHaveTextContent('3 puzzles');

    fireEvent.change(screen.getByTestId('set-editor-origin'), { target: { value: 'tactical' } });
    expect(screen.getByTestId('set-editor-preview-count')).toHaveTextContent('2 puzzles');

    fireEvent.change(screen.getByTestId('set-editor-target-size'), { target: { value: '1' } });
    expect(screen.getByTestId('set-editor-preview-count')).toHaveTextContent('1 puzzle');
  });

  it('creates a manual set from a touch multi-selection', async () => {
    await seedData();
    renderEditor('/training/new?source=manual');
    await waitForLoaded();

    fireEvent.click(screen.getByTestId('set-editor-source-manual'));

    fireEvent.click(screen.getByTestId(`set-editor-manual-list-select-${GAME.id}:6`));
    fireEvent.click(screen.getByTestId(`set-editor-manual-list-select-${GAME.id}:12`));

    expect(screen.getByTestId('set-editor-preview-count')).toHaveTextContent('2 puzzles');

    fireEvent.change(screen.getByTestId('set-editor-name'), { target: { value: 'Manual set' } });
    fireEvent.click(screen.getByTestId('set-editor-save'));

    await screen.findByTestId('navigated-set');
    const sets = await trainingSetsRepository.list({ status: 'active' });
    expect(sets[0]!.source).toEqual({ kind: 'manual' });
    expect(sets[0]!.puzzleIds).toHaveLength(2);
  });

  it('edits an existing set name in edit mode', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-edit', name: 'Old name', puzzleIds: ['g:1'] }),
    );
    renderEditor('/training/new?setId=set-edit');

    await waitFor(() => expect(screen.getByTestId('set-editor-name')).toHaveValue('Old name'));
    fireEvent.change(screen.getByTestId('set-editor-name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByTestId('set-editor-save'));

    await screen.findByTestId('navigated-set');
    const stored = await trainingSetsRepository.get('set-edit');
    expect(stored?.name).toBe('New name');
  });

  it('seeds a new set hint config from the stored global default', async () => {
    await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, {
      enabledLevels: [2, 4],
      firstHintLevel: 4,
    });
    await seedData();
    renderEditor(`/training/new?source=game&gameId=${GAME.id}`);
    await waitForLoaded();

    expect(screen.getByTestId('set-editor-hint-level-1')).not.toBeChecked();
    expect(screen.getByTestId('set-editor-hint-level-2')).toBeChecked();
    expect(screen.getByTestId('set-editor-hint-level-3')).not.toBeChecked();
    expect(screen.getByTestId('set-editor-hint-level-4')).toBeChecked();
    expect(screen.getByTestId('set-editor-first-hint')).toHaveValue('4');
  });

  it('keeps the stored config hints when editing an existing set', async () => {
    await settingsRepository.set(SETTINGS_KEYS.defaultHintConfig, {
      enabledLevels: [2, 4],
      firstHintLevel: 4,
    });
    await trainingSetsRepository.create(
      setFixture({
        id: 'set-hints-edit',
        name: 'Stored hints',
        puzzleIds: ['g:1'],
        config: {
          ordering: 'difficultyAsc',
          retryFailed: 'endOfCycle',
          hints: { enabledLevels: [1], firstHintLevel: 1 },
          allowSkip: true,
          targetAccuracy: null,
          targetSolvingTimeMs: null,
          plannedCycles: null,
          configVersion: 1,
        },
      }),
    );
    renderEditor('/training/new?setId=set-hints-edit');

    await waitFor(() => expect(screen.getByTestId('set-editor-name')).toHaveValue('Stored hints'));
    expect(screen.getByTestId('set-editor-hint-level-1')).toBeChecked();
    expect(screen.getByTestId('set-editor-hint-level-2')).not.toBeChecked();
    expect(screen.getByTestId('set-editor-first-hint')).toHaveValue('1');
  });
});
