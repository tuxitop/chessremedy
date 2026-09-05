import { describe, expect, it, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createAnalysisJob, markCompleted, markFailed } from '@/domain/analysis';
import { makeMove, TEST_ENGINE } from '@/domain/analysis/test-support';
import type { MoveAnalysis } from '@/domain/chess';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { createFakeAnalysisService } from '@/components/games/test-support/fakeAnalysisService';
import { renderWithProviders } from '@/test/test-utils';
import { GameReviewPage } from '@/pages/GameReviewPage';

const { chessboardProps } = vi.hoisted(() => ({
  chessboardProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/chessboard/Chessboard', () => ({
  Chessboard: (props: Record<string, unknown>) => {
    chessboardProps.push(props);
    return null;
  },
}));

const GAME = fixtureGame('cc-bullet-blunder'); // 1.f3 e5 2.g4?? Qh4# 0-1, user White

function reviewUrl(): string {
  return `/games/${GAME.id}/review`;
}

function renderReview(analysisService: AnalysisServiceLike | null): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/games/:id/review"
        element={<GameReviewPage analysisService={analysisService} />}
      />
    </Routes>,
    { initialEntries: [reviewUrl()] },
  );
}

function renderReviewAt(analysisService: AnalysisServiceLike | null, url: string): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/games/:id/review"
        element={<GameReviewPage analysisService={analysisService} />}
      />
    </Routes>,
    { initialEntries: [url] },
  );
}

async function seedCompleted(
  overrides: ReadonlyArray<Partial<MoveAnalysis>> = [],
): Promise<string> {
  await gamesRepository.saveGame(GAME);
  const job = createAnalysisJob(GAME.id, TEST_ENGINE, 4, 1);
  await analysisJobsRepository.putJob(markCompleted(job, 2));
  const records: MoveAnalysis[] = [
    {
      ...makeMove(0, {
        gameId: GAME.id,
        analysisId: job.id,
        side: 'white',
        playedMove: { san: 'f3', uci: 'f2f3' },
        classification: 'good',
      }),
    },
    {
      ...makeMove(1, {
        gameId: GAME.id,
        analysisId: job.id,
        side: 'black',
        playedMove: { san: 'e5', uci: 'e7e5' },
        classification: 'good',
      }),
    },
    {
      ...makeMove(2, {
        gameId: GAME.id,
        analysisId: job.id,
        side: 'white',
        playedMove: { san: 'g4', uci: 'g2g4' },
        classification: 'blunder',
      }),
    },
    {
      ...makeMove(3, {
        gameId: GAME.id,
        analysisId: job.id,
        side: 'black',
        playedMove: { san: 'Qh4#', uci: 'd8h4' },
        classification: 'best',
      }),
    },
  ].map((record, index) => ({ ...record, ...overrides[index] }));
  await analysesRepository.replaceAnalysis(records);
  return job.id;
}

describe('Game Review page (Feature 008)', () => {
  beforeEach(async () => {
    chessboardProps.length = 0;
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
  });

  it('renders a completed game with the move list, glyphs, summary and board sync', async () => {
    await seedCompleted();
    renderReview(null);

    expect(await screen.findByTestId('review-layout')).toBeInTheDocument();
    expect(screen.getByTestId('review-game-label')).toHaveTextContent('chessremedy');

    const moves = screen.getAllByTestId('move-list-move');
    expect(moves).toHaveLength(4);

    // White's 2.g4 blunder shows the ?? (NAG 4) classification glyph.
    const g4 = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!;
    const glyph = within(g4).getByTestId('nag-glyph');
    expect(glyph).toHaveAttribute('data-nag', '4');
    expect(glyph).toHaveTextContent('??');

    // Summary separates the user (White) from the opponent (Black).
    expect(screen.getByTestId('summary-user-blunder-value')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-user-best-value')).toHaveTextContent('0');
    expect(screen.getByTestId('summary-opponent-best-value')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-user-good-value')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-opponent-good-value')).toHaveTextContent('1');

    // The missed-tactic count is reserved (zero) until Feature 010.
    expect(screen.queryByTestId('summary-missed-tactics')).not.toBeInTheDocument();
  });

  it('selects a move, marks it aria-current and syncs the board position', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!);

    await waitFor(() => {
      const selected = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!;
      expect(selected).toHaveAttribute('aria-current', 'step');
    });
    const last = chessboardProps.at(-1)!;
    expect(last.orientation).toBe('white');
    expect(last.lastMove).toEqual(['g2', 'g4']);

    // Stored per-move evals, engine lines, engine identity and mistake review.
    expect(screen.getAllByTestId('ply-eval').length).toBeGreaterThan(0);
    expect(screen.getByTestId('engine-lines')).toBeInTheDocument();
    expect(screen.getByTestId('review-engine-chip')).toHaveTextContent('stockfish');
    const verdict = screen.getByTestId('review-verdict');
    expect(verdict).toHaveTextContent('blunder');
    expect(verdict).toHaveTextContent('Best:');
    expect(screen.getByTestId('review-swing')).toBeInTheDocument();
  });

  it('shows an obsolete-analysis banner and allows re-analysis', async () => {
    const jobId = await seedCompleted();
    // Downgrade the stored analysis version so the banner appears.
    const stored = (await analysisJobsRepository.getJob(jobId))!;
    await analysisJobsRepository.putJob({ ...stored, analysisVersion: 0 });

    const fake = createFakeAnalysisService();
    renderReview(fake.service);

    expect(await screen.findByTestId('review-obsolete')).toBeInTheDocument();
    expect(screen.getByTestId('review-reanalyze')).toBeInTheDocument();
  });

  it('shows the no-analysis state and analyzes the game on demand', async () => {
    await gamesRepository.saveGame(GAME);
    const fake = createFakeAnalysisService();
    renderReview(fake.service);

    const action = await screen.findByTestId('review-action');
    expect(action).toHaveTextContent('Analyze this game');

    await userEvent.setup().click(action);
    await waitFor(() => expect(screen.getByTestId('review-layout')).toBeInTheDocument());
    expect(await analysesRepository.countForGame(GAME.id)).toBe(4);
  });

  it('shows a failed-analysis state with the stored error', async () => {
    await gamesRepository.saveGame(GAME);
    const job = createAnalysisJob(GAME.id, TEST_ENGINE, 4, 1);
    await analysisJobsRepository.putJob(markFailed(job, 'Engine crashed', 2));

    renderReview(null);

    const state = await screen.findByText('Analysis failed');
    expect(state).toBeInTheDocument();
    expect(screen.getByTestId('review-state')).toHaveTextContent('Engine crashed');
    expect(screen.getByTestId('review-action')).toHaveTextContent('Retry analysis');
  });

  it('renders a missing-game state for an unknown id', async () => {
    renderReviewAt(null, '/games/unknown:1/review');
    expect(await screen.findByText('Game not found')).toBeInTheDocument();
  });

  it('renders an in-progress state with persisted progress', async () => {
    await gamesRepository.saveGame(GAME);
    const job = createAnalysisJob(GAME.id, TEST_ENGINE, 4, 1);
    await analysisJobsRepository.putJob({
      ...job,
      state: 'inProgress',
      completedPositions: 2,
      startedAt: 1,
    });

    renderReview(null);
    const state = await screen.findByText('Analysis in progress');
    expect(state).toBeInTheDocument();
    expect(screen.getByTestId('review-state')).toHaveTextContent('2 of 4');
  });

  it('shows a stored evaluation bar and toggleable arrows/lines/evaluations', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    // Stored evaluation bar shows the start position's stored evaluation.
    const bar = screen.getByTestId('evaluation-bar');
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute('aria-label')).toMatch(/^Evaluation:/);

    // Best-move arrows default on and draw the stored top move (f2–f3).
    const board = () => chessboardProps.at(-1)!;
    expect(board().autoShapes).toEqual([{ orig: 'f2', dest: 'f3', brush: 'best' }]);

    // The analysis-controls area toggles display options.
    expect(screen.getByTestId('review-toggle-arrows')).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(screen.getByTestId('review-toggle-arrows'));
    expect(screen.getByTestId('review-toggle-arrows')).toHaveAttribute('aria-checked', 'false');
    expect(board().autoShapes).toEqual([]);

    // Engine lines and per-move evaluations appear once a move is selected and
    // can be hidden independently.
    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!);
    expect(screen.getByTestId('engine-lines')).toBeInTheDocument();
    expect(screen.getAllByTestId('ply-eval').length).toBeGreaterThan(0);
    await user.click(screen.getByTestId('review-toggle-lines'));
    expect(screen.queryByTestId('engine-lines')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('review-toggle-evals'));
    expect(screen.queryByTestId('evaluation-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ply-eval')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-eval')).not.toBeInTheDocument();
  });

  it('shows the selected move’s engine depth', async () => {
    await seedCompleted([{ depth: 21 }]);
    renderReview(null);
    await screen.findByTestId('review-layout');

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'f3')!);
    expect(screen.getByTestId('review-depth')).toHaveTextContent('Depth 21');
  });

  it('offers a distinct live-analysis mode that never overwrites stored records', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('review-enter-live'));
    await screen.findByTestId('review-live-layout');
    expect(screen.getByTestId('review-live-label')).toBeInTheDocument();
    expect(screen.getByTestId('review-exit-live')).toBeInTheDocument();
    // Stored panels are not rendered while live.
    expect(screen.queryByTestId('review-summary')).not.toBeInTheDocument();

    // Nothing was persisted: the stored analysis is untouched.
    expect(await analysesRepository.countForGame(GAME.id)).toBe(4);

    // Returning to stored review restores the stored surface.
    await user.click(screen.getByTestId('review-exit-live'));
    await screen.findByTestId('review-layout');
    expect(screen.getByTestId('review-summary')).toBeInTheDocument();
  });
});
