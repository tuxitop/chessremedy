import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import {
  createAnalysisJob,
  markCompleted,
  type AnalysisJob,
  type GameAnalysisStatus,
} from '@/domain/analysis';
import { TEST_ENGINE } from '@/domain/analysis/test-support';
import { puzzleFixtures, blunderPuzzleFixtures } from '@/domain/puzzle/test-support';
import { PUZZLE_GENERATOR_VERSION } from '@/domain/puzzle';
import type { Game } from '@/domain/chess/game';
import type { PuzzleRow } from '@/domain/puzzle';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { renderWithProviders } from '@/test/test-utils';
import { GamePuzzlesPage } from '@/pages/GamePuzzlesPage';

const { chessboardProps } = vi.hoisted(() => ({
  chessboardProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/chessboard/Chessboard', () => ({
  Chessboard: (props: Record<string, unknown>) => {
    chessboardProps.push(props);
    return null;
  },
}));

const GAME = fixtureGame('cc-bullet-blunder'); // user White, matches the White-side fixtures
const NOW = 1_700_000_000_000;

type SummaryOverrides = Partial<
  Omit<AnalysisSummaryRow, 'analysisId' | 'gameId' | 'userColor' | 'updatedAt'>
>;

function summaryRowFor(
  analysisId: string,
  game: Game,
  overrides: SummaryOverrides = {},
): AnalysisSummaryRow {
  return {
    analysisId,
    gameId: game.id,
    userColor: game.userColor,
    classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    userMoves: 0,
    totalMoves: 0,
    accuracy: null,
    accuracyMoves: 0,
    detectionState: 'absent',
    missedTacticCount: null,
    detectionVersion: null,
    updatedAt: NOW,
    ...overrides,
  };
}

async function seedGame(
  overrides: SummaryOverrides = {},
): Promise<{ game: Game; job: AnalysisJob }> {
  await gamesRepository.saveGame(GAME);
  const job = markCompleted(createAnalysisJob(GAME.id, TEST_ENGINE, 2, NOW), NOW + 1);
  await analysisJobsRepository.putJob(job);
  await summariesRepository.putForAnalysis(
    summaryRowFor(job.id, GAME, {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: 70,
      missedTacticCount: 1,
      ...overrides,
    }),
  );
  return { game: GAME, job };
}

/** Seed one puzzle row (a deterministic fixture) for the test game at `ply`. */
function rowFor(ply: number): PuzzleRow {
  const base =
    ply === 6
      ? puzzleFixtures['mate-one']
      : ply === 8
        ? puzzleFixtures['material-combination']
        : puzzleFixtures['accepted-alternatives'];
  return { ...base, sourceGameId: GAME.id, sourcePly: ply };
}

async function seedPuzzles(plies: readonly number[]): Promise<void> {
  await puzzlesRepository.addIfAbsent(plies.map(rowFor));
}

function renderPuzzles(analysisService: AnalysisServiceLike | null): void {
  renderWithProviders(
    <Routes>
      <Route
        path="/games/:id/puzzles"
        element={<GamePuzzlesPage analysisService={analysisService} />}
      />
    </Routes>,
    { initialEntries: [`/games/${GAME.id}/puzzles`] },
  );
}

function completedSummary(): SummaryOverrides {
  return {
    detectionState: 'completed',
    detectionVersion: DETECTION_VERSION,
    puzzleState: 'completed',
    puzzleProgress: { done: 2, total: 2 },
    puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  };
}

/** Scriptable fake exposing the Feature-011 on-demand generation surface. */
function generationService(): {
  service: AnalysisServiceLike;
  calls: string[];
  generating: Set<string>;
} {
  const calls: string[] = [];
  const generating = new Set<string>();
  const service: AnalysisServiceLike = {
    async analyzeGames() {
      return [];
    },
    async statusesOf(gameIds) {
      const out: Record<string, GameAnalysisStatus> = {};
      for (const id of gameIds) out[id] = 'completed';
      return out;
    },
    async listActiveJobs() {
      return [];
    },
    async cancelGame() {},
    async activeDetectionGames() {
      return [];
    },
    async activeGenerationGames() {
      return new Set(generating);
    },
    async generatePuzzles(gameId) {
      calls.push(gameId);
      // Like the real service, a fresh pass persists its queued/inProgress
      // progress before it is reported as live (so the page's optimistic
      // registry + reload read the recorded `done/total`).
      const job = (await analysisJobsRepository.listByGame(gameId)).find(
        (candidate) => candidate.state === 'completed',
      );
      if (job) {
        const existing = await summariesRepository.getForAnalysis(job.id);
        if (!existing || existing.puzzleState === undefined || existing.puzzleState === 'absent') {
          await summariesRepository.patchForAnalysis(job.id, {
            puzzleState: 'inProgress',
            puzzleProgress: { done: 1, total: 1 },
          });
        }
      }
      generating.add(gameId);
      return 'started';
    },
    async cancelGeneration(gameId) {
      generating.delete(gameId);
    },
  };
  return { service, calls, generating };
}

describe('Game Puzzles page (Feature 011, Stage E)', () => {
  beforeEach(async () => {
    chessboardProps.length = 0;
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.puzzles.clear();
  });

  it('renders every puzzle card in ply order with a drawable board, difficulty, objective and provenance', async () => {
    await seedGame(completedSummary());
    await seedPuzzles([20, 6, 8]);
    renderPuzzles(null);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('3 puzzles');

    const list = screen.getByTestId('puzzles-list');
    const cards = [...list.querySelectorAll('[data-testid^="puzzle-card-"]')];
    expect(cards.map((card) => card.getAttribute('data-testid'))).toEqual([
      'puzzle-card-6',
      'puzzle-card-8',
      'puzzle-card-20',
    ]);

    // Boards: one Chessboard per puzzle, pieces frozen but drawable for
    // inspection (free-draw + arrows). The user's played move is always marked
    // with a red arrow; the solution is hidden, so no green arrow yet.
    expect(screen.getAllByTestId(/^puzzle-board-/)).toHaveLength(3);
    expect(chessboardProps).toHaveLength(3);
    for (const props of chessboardProps) {
      expect(props.interactive).toBe(false);
      expect(props.drawable).toBe(true);
      expect(props.onMove).toBeUndefined();
      expect(props.onPromotionRequired).toBeUndefined();
      expect(props.orientation).toBe('white');
      expect(props.autoShapes).toEqual([
        { orig: expect.any(String), dest: expect.any(String), brush: 'red' },
      ]);
    }

    // mate-one (ply 6): Move 4, Trivial · 12, Forced mate, You played d3.
    // The solution SAN is hidden behind the per-card reveal until pressed.
    const mateOne = within(screen.getByTestId('puzzle-card-6'));
    expect(mateOne.getByTestId('puzzle-objective-6')).toHaveTextContent('Forced mate');
    expect(mateOne.getByTestId('puzzle-difficulty-6')).toHaveTextContent('Trivial · 12');
    expect(mateOne.getByTestId('puzzle-provenance-6')).toHaveTextContent('Move 4 (ply 6)');
    expect(mateOne.getByTestId('puzzle-played-6')).toHaveTextContent('You played d3');
    expect(mateOne.queryByTestId('puzzle-solution-6')).not.toBeInTheDocument();
    expect(mateOne.queryByTestId('puzzle-accepted-6')).not.toBeInTheDocument();
    const reveal6 = mateOne.getByTestId('puzzle-reveal-6');
    expect(reveal6).toHaveTextContent('Show solution');
    expect(reveal6).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(reveal6);
    const revealedMateOne = within(screen.getByTestId('puzzle-card-6'));
    expect(await waitFor(() => revealedMateOne.getByTestId('puzzle-solution-6'))).toHaveTextContent(
      /Qxf7/,
    );
    expect(revealedMateOne.getByTestId('puzzle-reveal-6')).toHaveTextContent('Hide solution');
    expect(revealedMateOne.getByTestId('puzzle-reveal-6')).toHaveAttribute('aria-pressed', 'true');
    expect(revealedMateOne.queryByTestId('puzzle-accepted-6')).not.toBeInTheDocument();

    // Revealing adds the green solution arrow to that card's board.
    const redAndGreen = chessboardProps[chessboardProps.length - 1];
    expect(redAndGreen?.autoShapes).toEqual([
      { orig: 'd2', dest: 'd3', brush: 'red' },
      { orig: 'h5', dest: 'f7', brush: 'green' },
    ]);

    // The reveal is per card: the other cards keep their solution hidden.
    const material = within(screen.getByTestId('puzzle-card-8'));
    expect(material.queryByTestId('puzzle-solution-8')).not.toBeInTheDocument();

    // accepted-alternatives (ply 20): the extra accepted first moves are part
    // of the solution, so they appear only after that card's own reveal.
    const alternatives = within(screen.getByTestId('puzzle-card-20'));
    expect(alternatives.getByTestId('puzzle-objective-20')).toHaveTextContent('Winning material');
    expect(alternatives.getByTestId('puzzle-difficulty-20')).toHaveTextContent('Medium · 52');
    expect(alternatives.getByTestId('puzzle-provenance-20')).toHaveTextContent('Move 11 (ply 20)');
    expect(alternatives.queryByTestId('puzzle-accepted-20')).not.toBeInTheDocument();
    fireEvent.click(alternatives.getByTestId('puzzle-reveal-20'));
    const revealedAlternatives = within(screen.getByTestId('puzzle-card-20'));
    expect(
      await waitFor(() => revealedAlternatives.getByTestId('puzzle-accepted-20')),
    ).toHaveTextContent('Also accepted');
  });

  it('renders a one-move blunder correct-move puzzle with its own objective label and reveal', async () => {
    await seedGame(completedSummary());
    await puzzlesRepository.addIfAbsent([
      { ...blunderPuzzleFixtures['correct-move'], sourceGameId: GAME.id, sourcePly: 12 },
    ]);
    renderPuzzles(null);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('1 puzzle');

    const card = within(screen.getByTestId('puzzle-card-12'));
    expect(card.getByTestId('puzzle-objective-12')).toHaveTextContent('Find the best move');
    expect(card.getByTestId('puzzle-difficulty-12')).toBeVisible();
    expect(card.getByTestId('puzzle-played-12')).toHaveTextContent('You played d3');
    // Blunder rows carry no accepted alternatives and hide the one-move
    // solution until the per-card reveal.
    expect(card.queryByTestId('puzzle-accepted-12')).not.toBeInTheDocument();
    expect(card.queryByTestId('puzzle-solution-12')).not.toBeInTheDocument();

    fireEvent.click(card.getByTestId('puzzle-reveal-12'));
    const revealed = within(screen.getByTestId('puzzle-card-12'));
    expect(await waitFor(() => revealed.getByTestId('puzzle-solution-12'))).toHaveTextContent(
      /Qxf7/,
    );
    expect(revealed.getByTestId('puzzle-reveal-12')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a completed generation with zero puzzles as a real "0 puzzles", never a list', async () => {
    await seedGame(completedSummary());
    renderPuzzles(null);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('0 puzzles');
    expect(screen.queryByTestId('puzzles-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('puzzles-empty')).toHaveTextContent('No puzzles were generated');
  });

  it('generates on demand: Puzzles not generated → live progress → completed on poll', async () => {
    await seedGame({
      detectionState: 'completed',
      detectionVersion: DETECTION_VERSION,
      puzzleState: 'absent',
    });
    const rig = generationService();
    renderPuzzles(rig.service);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('Puzzles not generated');
    const generate = screen.getByTestId('puzzles-generate');
    expect(generate).toHaveTextContent('Generate puzzles');

    fireEvent.click(generate);
    await waitFor(() => expect(rig.calls).toEqual([GAME.id]));

    // The pass is live with recorded progress: the optimistic registry +
    // reload read the persisted `done/total` as the live state line.
    await waitFor(
      () =>
        expect(screen.getByTestId('puzzles-state-note')).toHaveTextContent(
          'Generating puzzle 1 of 1…',
        ),
      { timeout: 6000 },
    );

    // The pass settles: one immutable row written, the summary completed and
    // the live registry emptied — the poll reloads the real count.
    const job = (await analysisJobsRepository.listByGame(GAME.id)).find(
      (candidate) => candidate.state === 'completed',
    )!;
    await summariesRepository.patchForAnalysis(job.id, {
      puzzleState: 'completed',
      puzzleProgress: { done: 1, total: 1 },
      puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
    });
    await puzzlesRepository.addIfAbsent([rowFor(6)]);
    rig.generating.delete(GAME.id);
    await waitFor(
      () => expect(screen.getByTestId('puzzles-state-note')).toHaveTextContent('1 puzzle'),
      { timeout: 6000 },
    );
    expect(screen.getByTestId('puzzle-card-6')).toBeInTheDocument();
  });

  it('labels an interrupted generation pass and resumes it on demand', async () => {
    await seedGame({
      detectionState: 'completed',
      detectionVersion: DETECTION_VERSION,
      puzzleState: 'inProgress',
      puzzleProgress: { done: 1, total: 4 },
    });
    const rig = generationService();
    renderPuzzles(rig.service);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('Puzzle generation interrupted');
    const resume = screen.getByTestId('puzzles-resume');
    expect(resume).toHaveTextContent('Resume puzzle generation');

    fireEvent.click(resume);
    await waitFor(() => expect(rig.calls).toEqual([GAME.id]));
    // Optimistic live registry: the interrupted pass reads as generating again.
    await waitFor(() =>
      expect(screen.getByTestId('puzzles-state-note')).toHaveTextContent(
        'Generating puzzle 1 of 4…',
      ),
    );
  });

  it('labels a failed generation pass and offers Retry', async () => {
    await seedGame({
      detectionState: 'completed',
      detectionVersion: DETECTION_VERSION,
      puzzleState: 'failed',
    });
    const rig = generationService();
    renderPuzzles(rig.service);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('Puzzle generation failed');
    const retry = screen.getByTestId('puzzles-retry');
    expect(retry).toHaveTextContent('Retry puzzle generation');

    fireEvent.click(retry);
    await waitFor(() => expect(rig.calls).toEqual([GAME.id]));
  });

  it('shows a detection note and no generation action while detection has not completed', async () => {
    // A completed analysis whose detection pass is absent/not completed: the
    // view explains the scan gate, never a generate action, never a fake zero.
    await seedGame({
      detectionState: 'absent',
      puzzleState: 'absent',
    });
    renderPuzzles(null);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('Tactics scan must complete');
    expect(screen.queryByTestId('puzzles-generate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-resume')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-empty')).not.toBeInTheDocument();
    expect(note).not.toHaveTextContent('0 puzzles');
  });

  it('suppresses an outdated completed detection with the out-of-date note (R-6) but keeps rows inspectable', async () => {
    // A completed detection from an older DETECTION_VERSION is stale: puzzle
    // count/state notes are suppressed with the out-of-date note even though
    // immutable puzzle rows exist (the rows remain inspectable).
    await seedGame({
      detectionState: 'completed',
      detectionVersion: DETECTION_VERSION - 1,
      missedTacticCount: 1,
      puzzleState: 'completed',
      puzzleProgress: { done: 1, total: 1 },
      puzzleGeneratorVersion: 1,
    });
    await seedPuzzles([6]);
    renderPuzzles(null);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('older version');
    expect(note).toHaveTextContent('out of date');
    expect(screen.queryByTestId('puzzles-generate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-resume')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-regenerate')).not.toBeInTheDocument();
    expect(screen.getByTestId('puzzle-card-6')).toBeInTheDocument();
  });

  it('offers Regenerate puzzles on an outdated completed pass (older generator) and regenerates on demand', async () => {
    // A completed pass from the previous v1 generator with fresh detection: the
    // rows stay inspectable, the count line stays, and the header offers the
    // engine-free Regenerate action (regeneration adds one-move blunder rows).
    await seedGame({
      detectionState: 'completed',
      detectionVersion: DETECTION_VERSION,
      puzzleState: 'completed',
      puzzleProgress: { done: 2, total: 2 },
      puzzleGeneratorVersion: 1,
    });
    await seedPuzzles([6]);
    const rig = generationService();
    renderPuzzles(rig.service);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('1 puzzle');
    expect(note).toHaveTextContent('older generator');
    const regenerate = screen.getByTestId('puzzles-regenerate');
    expect(regenerate).toHaveTextContent('Regenerate puzzles');
    // The immutable row stays inspectable alongside the regenerate affordance.
    expect(screen.getByTestId('puzzle-card-6')).toBeInTheDocument();

    fireEvent.click(regenerate);
    await waitFor(() => expect(rig.calls).toEqual([GAME.id]));
  });

  it('a current-version completed pass offers no Regenerate action', async () => {
    await seedGame(completedSummary());
    await seedPuzzles([6]);
    const rig = generationService();
    renderPuzzles(rig.service);

    const note = await screen.findByTestId('puzzles-state-note');
    expect(note).toHaveTextContent('1 puzzle');
    expect(note).not.toHaveTextContent('older generator');
    expect(screen.queryByTestId('puzzles-regenerate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-generate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-resume')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-retry')).not.toBeInTheDocument();
  });
});
