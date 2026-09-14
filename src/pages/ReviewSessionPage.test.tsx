/**
 * ReviewSessionPage tests (Feature 020).
 *
 * Real Dexie over fake-indexeddb with a deterministic injected clock and a
 * controllable `SolveScreen` stub (no board/engine). The `ReviewService` uses
 * the pure `fakeScheduler` so the projection is deterministic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { PuzzleRow } from '@/domain/puzzle';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { REVIEW_SET_ID } from '@/domain/review';
import { fakeScheduler } from '@/domain/review/test-support';
import { presentationOutcomeOf, type PuzzleAttemptRow } from '@/domain/training';
import { db } from '@/infrastructure/db/database';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { reviewSchedulesRepository } from '@/infrastructure/db/review-schedules-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { CycleService } from '@/infrastructure/training';
import { ReviewService } from '@/infrastructure/review';
import { renderWithProviders } from '@/test/test-utils';
import { ReviewSessionPage } from './ReviewSessionPage';

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
              startedAt: NOW - 5_000,
            });
            props.onExit(presentationOutcomeOf(attemptRow as PuzzleAttemptRow));
          })();
        }}
      >
        Solve
      </button>
      <button
        data-testid="solve-stub-skip"
        onClick={() => {
          void (async () => {
            const { attemptRow } = await props.recorder.record({
              row: props.row,
              context: props.context,
              trigger: 'skip',
              counters: { wrongMoveCount: 0, hintCount: 0, highestHintLevel: null },
              startedAt: NOW - 5_000,
            });
            props.onExit(presentationOutcomeOf(attemptRow as PuzzleAttemptRow));
          })();
        }}
      >
        Skip
      </button>
      <button data-testid="solve-stub-discard" onClick={() => props.onExit(null)}>
        Discard
      </button>
    </div>
  ),
}));

const NOW = new Date(2023, 10, 14, 12, 0, 0, 0).getTime();

function puzzleFor(ply: number): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), sourceGameId: 'game:review', sourcePly: ply };
}

function idOf(puzzle: PuzzleRow): string {
  return puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly);
}

function makeReviewService(): ReviewService {
  return new ReviewService({
    cycles: trainingCyclesRepository,
    sets: trainingSetsRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    schedules: reviewSchedulesRepository,
    settings: settingsRepository,
    scheduler: fakeScheduler,
    now: () => NOW,
    newId: () => 'review-cycle-1',
  });
}

function makeCycleService(): CycleService {
  return new CycleService({
    cycles: trainingCyclesRepository,
    sets: trainingSetsRepository,
    puzzles: puzzlesRepository,
    attempts: attemptsRepository,
    now: () => NOW,
    newId: () => 'review-cycle-1',
  });
}

function renderPage(): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/training/review"
        element={
          <ReviewSessionPage
            reviewService={makeReviewService()}
            cycleService={makeCycleService()}
            now={() => NOW}
          />
        }
      />
      <Route path="/training" element={<div data-testid="training-home" />} />
    </Routes>,
    { initialEntries: ['/training/review'] },
  );
}

describe('ReviewSessionPage (Feature 020)', () => {
  beforeEach(async () => {
    await db.puzzleSchedules.clear();
    await db.puzzles.clear();
    await db.puzzleAttempts.clear();
    await db.trainingCycles.clear();
    await db.trainingSets.clear();
    await db.settings.clear();
  });

  it('shows the setup counts, starts a review cycle and grades each solve', async () => {
    const rows = [puzzleFor(6), puzzleFor(8)];
    await puzzlesRepository.addIfAbsent(rows);

    renderPage();
    await waitFor(() => expect(screen.getByTestId('review-setup-due')).toHaveTextContent('0'));
    expect(screen.getByTestId('review-setup-new')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('session-begin'));
    await waitFor(() => expect(screen.getByTestId('solve-stub')).toBeInTheDocument());
    expect(screen.getByTestId('solve-stub-allow-skip')).toHaveTextContent('true');

    fireEvent.click(screen.getByTestId('solve-stub-solve'));
    await waitFor(async () => {
      expect(await reviewSchedulesRepository.get(idOf(rows[0]!))).toBeDefined();
    });
    const row = await reviewSchedulesRepository.get(idOf(rows[0]!));
    expect(row!.lastGrade).toBe('easy');

    fireEvent.click(screen.getByTestId('solve-stub-solve'));
    await waitFor(() => expect(screen.getByTestId('session-summary')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Review summary' })).toBeInTheDocument();

    const cycles = await trainingCyclesRepository.listForSet(REVIEW_SET_ID);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.config.retryFailed).toBe('none');
    expect(cycles[0]!.puzzleIds).toEqual(rows.map(idOf));
  });

  it('applies no grade when a presentation is skipped', async () => {
    const rows = [puzzleFor(6)];
    await puzzlesRepository.addIfAbsent(rows);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('review-setup-new')).toHaveTextContent('1'));

    fireEvent.click(screen.getByTestId('session-begin'));
    await waitFor(() => expect(screen.getByTestId('solve-stub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('solve-stub-skip'));

    await waitFor(() => expect(screen.getByTestId('session-summary')).toBeInTheDocument());
    expect(await reviewSchedulesRepository.get(idOf(rows[0]!))).toBeUndefined();
  });

  it('writes no row and keeps the puzzle pending when a presentation is discarded', async () => {
    const rows = [puzzleFor(6)];
    await puzzlesRepository.addIfAbsent(rows);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('review-setup-new')).toHaveTextContent('1'));

    fireEvent.click(screen.getByTestId('session-begin'));
    await waitFor(() => expect(screen.getByTestId('solve-stub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('solve-stub-discard'));

    await waitFor(() => expect(screen.getByTestId('review-session-notice')).toBeInTheDocument());
    expect(await attemptsRepository.listForCycle('review-cycle-1')).toEqual([]);
    expect(await reviewSchedulesRepository.get(idOf(rows[0]!))).toBeUndefined();
    // The puzzle is still presented (no completion).
    expect(screen.getByTestId('solve-stub')).toBeInTheDocument();
  });

  it('disables Start when the queue is empty', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('review-setup-new')).toHaveTextContent('0'));
    expect(screen.getByTestId('session-begin')).toBeDisabled();
  });
});
