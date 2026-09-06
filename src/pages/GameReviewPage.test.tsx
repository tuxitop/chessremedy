import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createAnalysisJob, markCompleted, markFailed } from '@/domain/analysis';
import { blunderGameRecords } from '@/domain/analysis/fixtures/classificationScenarios';
import { TEST_ENGINE } from '@/domain/analysis/test-support';
import type { EngineMetadata, MoveAnalysis } from '@/domain/chess';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { createFakeAnalysisService } from '@/components/games/test-support/fakeAnalysisService';
import { renderWithProviders } from '@/test/test-utils';
import { GameReviewPage, classificationBoardBadges } from '@/pages/GameReviewPage';

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
  overrides: ReadonlyArray<Partial<MoveAnalysis> | undefined> = [],
  engine: EngineMetadata = TEST_ENGINE,
): Promise<string> {
  await gamesRepository.saveGame(GAME);
  const job = createAnalysisJob(GAME.id, engine, 4, 1);
  await analysisJobsRepository.putJob(markCompleted(job, 2));
  const records = blunderGameRecords(GAME.id, job.id).map((record, index) => ({
    ...record,
    engine,
    ...overrides[index],
  }));
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

    // Black's mating Qh4# is the engine's best move: best moves render quiet
    // (no !! glyph) — only negative classifications are annotated (R2-3).
    const qh4 = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'Qh4#')!;
    expect(within(qh4).queryByTestId('nag-glyph')).not.toBeInTheDocument();

    // Ordinary (`good`) moves — 1.f3 and 1...e5 — render no classification glyph.
    for (const san of ['f3', 'e5']) {
      const move = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === san)!;
      expect(within(move).queryByTestId('nag-glyph')).not.toBeInTheDocument();
    }

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
    const custom = (): ReadonlyMap<string, string> | undefined =>
      (chessboardProps.at(-1)! as { customSquareClasses?: ReadonlyMap<string, string> })
        .customSquareClasses;

    // Ordinary (good) move keeps the plain last-move highlight, no color class.
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'f3')!);
    expect(chessboardProps.at(-1)!.lastMove).toEqual(['f2', 'f3']);
    expect(custom()).toBeUndefined();

    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!);

    await waitFor(() => {
      const selected = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!;
      expect(selected).toHaveAttribute('aria-current', 'step');
    });
    const last = chessboardProps.at(-1)!;
    expect(last.orientation).toBe('white');
    // The blunder replaces the plain last-move highlight with classification
    // coloring on the move's start and end squares.
    expect(last.lastMove).toBeNull();
    expect(custom()).toEqual(
      new Map([
        ['g2', 'review-cls-blunder'],
        ['g4', 'review-cls-blunder'],
      ]),
    );

    // Stored per-move evals + the shared engine panel fed by cached data
    // (engine off): stored lines and the analysis identity in the header.
    expect(screen.getAllByTestId('ply-eval').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('stored-line').length).toBeGreaterThan(0);
    expect(screen.getByTestId('engine-version')).toHaveTextContent('stockfish');
    expect(screen.getByTestId('position-eval')).toHaveTextContent(/\d/);
  });

  it('shows board NAG chips (Playground style) for emphasized classifications', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const board = () => chessboardProps.at(-1)!;
    const overlayItems = (): unknown =>
      (board().overlay as { props?: { items?: unknown } } | undefined)?.props?.items;

    // Start position has no played move → no chip.
    expect(overlayItems()).toBeUndefined();

    const user = userEvent.setup();
    // An ordinary (`good`) move renders no chip.
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'f3')!);
    expect(overlayItems()).toBeUndefined();

    // 2.g4 is a blunder → a ?? chip anchored to g4.
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!);
    await waitFor(() =>
      expect(overlayItems()).toEqual([
        { square: 'g4', text: '??', color: '#c4261c', kind: 'nag', testId: 'nag-badge' },
      ]),
    );

    // Qh4# is the engine's best move → a !! chip anchored to h4.
    await user.click(
      screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'Qh4#')!,
    );
    await waitFor(() =>
      expect(overlayItems()).toEqual([
        { square: 'h4', text: '!!', color: '#0a7a3c', kind: 'nag', testId: 'nag-badge' },
      ]),
    );
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

  it('flags an analysis produced by an older engine as outdated (ADR-020)', async () => {
    await seedCompleted([], { ...TEST_ENGINE, engineVersion: '18.0.0' });
    const fake = createFakeAnalysisService();
    renderReview(fake.service);

    expect(await screen.findByTestId('review-obsolete')).toBeInTheDocument();
    expect(screen.getByTestId('review-reanalyze')).toBeInTheDocument();
    expect(screen.getByTestId('engine-version')).toHaveTextContent('18.0.0');
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

  it('shows the stored evaluation bar, best-move arrows and cached engine lines', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    // Stored evaluation bar shows the start position's stored evaluation.
    const bar = screen.getByTestId('evaluation-bar');
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute('aria-label')).toMatch(/^Evaluation:/);

    // Best-move arrows draw the stored top move (e2–e4) from the start.
    const board = () => chessboardProps.at(-1)!;
    expect(board().autoShapes).toEqual([{ orig: 'e2', dest: 'e4', brush: 'best' }]);

    // Selecting a move fills the shared engine panel from cached data.
    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!);
    expect(screen.getAllByTestId('stored-line').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('ply-eval').length).toBeGreaterThan(0);
  });

  it('shows the displayed position’s stored engine depth', async () => {
    // The position shown after 1.f3 is the start of move two (record index 1).
    await seedCompleted([undefined, { depth: 21 }]);
    renderReview(null);
    await screen.findByTestId('review-layout');

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'f3')!);
    await waitFor(() =>
      expect(screen.getByTestId('engine-depth-row')).toHaveTextContent('Depth: 21'),
    );
  });

  it('shows per-player clock bars above and below the board', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    // Fallback to the time-control base before any %clk move is played.
    const opponent = screen.getByTestId('review-clock-opponent-time');
    const user = screen.getByTestId('review-clock-user-time');
    expect(opponent).toHaveTextContent(/^\d+:\d\d$/);
    expect(user).toHaveTextContent(/^\d+:\d\d$/);
    expect(screen.getByTestId('review-clock-opponent').textContent).toContain('bulletpete');
  });

  it('supports keyboard navigation through the moves (arrow keys)', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const user = userEvent.setup();
    const activeSan = () =>
      screen.getAllByTestId('move-list-move').find((b) => b.getAttribute('aria-current') === 'step')
        ?.dataset.san;

    await user.keyboard('{ArrowRight}');
    expect(activeSan()).toBe('f3');
    await user.keyboard('{ArrowRight}');
    expect(activeSan()).toBe('e5');
    await user.keyboard('{ArrowLeft}');
    expect(activeSan()).toBe('f3');
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(activeSan()).toBeUndefined();
  });

  it('renders the board interactive and drawable with working settings toggles', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const board = () => chessboardProps.at(-1)!;
    // Board is a working analysis board by default: interactive + drawable.
    expect(board().interactive).toBe(true);
    expect(board().drawable).toBe(true);
    expect(typeof board().onMove).toBe('function');
    expect(typeof board().onPromotionRequired).toBe('function');

    // Board settings act on the Review board (e.g. turn interactivity off).
    const user = userEvent.setup();
    await user.click(screen.getByTestId('settings-cog'));
    await user.click(screen.getByTestId('setting-interactive'));
    await user.click(screen.getByTestId('settings-cog'));
    expect(board().interactive).toBe(false);
    // Clearing arrows is wired to the board handle.
    await user.click(screen.getByTestId('settings-cog'));
    expect(screen.getByTestId('setting-clear-arrows')).toBeInTheDocument();
  });

  it('lets the user play an alternate move that appears as a variation', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const board = () => chessboardProps.at(-1)!;
    const moves = (): string[] =>
      screen.getAllByTestId('move-list-move').map((b) => b.dataset.san ?? '');

    const user = userEvent.setup();
    expect(moves()).toHaveLength(4);

    // After 1...e5 it is White to move; deviate with 2.Nc3 instead of 2.g4.
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'e5')!);
    await waitFor(() => expect(board()).toBeTruthy());
    act(() => {
      (board() as { onMove: (from: string, to: string) => void }).onMove('b1', 'c3');
    });

    await waitFor(() => expect(moves()).toHaveLength(5));
    const nc3 = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'Nc3');
    expect(nc3).toBeTruthy();
    expect(nc3).toHaveAttribute('aria-current', 'step');

    // The appended variation is transient: nothing is persisted to the game.
    expect(await analysesRepository.countForGame(GAME.id)).toBe(4);
  });

  it('hides the empty engine-lines area when off and reserves it while on', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const user = userEvent.setup();
    // A stored mainline position (engine off) still shows its stored lines.
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'e5')!);
    expect(screen.getByTestId('engine-result')).toBeInTheDocument();

    // The final position has no stored lines → no empty engine-lines area.
    await user.click(
      screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'Qh4#')!,
    );
    await waitFor(() => expect(screen.queryByTestId('engine-result')).not.toBeInTheDocument());
    expect(screen.queryByTestId('engine-line-placeholder')).not.toBeInTheDocument();

    // Turning the engine on reserves the region even before any line arrives.
    await user.click(screen.getByTestId('engine-toggle'));
    expect(screen.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('engine-result')).toBeInTheDocument();
  });

  it('toggles the engine on in place without ever overwriting stored records', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    const toggle = screen.getByTestId('engine-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    const user = userEvent.setup();
    // All four stored per-move evaluations are shown with the engine off.
    expect(screen.getAllByTestId('ply-eval')).toHaveLength(4);

    await user.click(toggle);
    expect(screen.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'true');
    // One single surface throughout; the stored analysis is untouched.
    expect(screen.getByTestId('review-layout')).toBeInTheDocument();
    expect(await analysesRepository.countForGame(GAME.id)).toBe(4);
    // Turning live analysis on must not dismiss the saved evaluations: moves
    // that have no fresh live result yet keep their stored per-move value.
    expect(screen.getAllByTestId('ply-eval')).toHaveLength(4);

    await user.click(screen.getByTestId('engine-toggle'));
    expect(screen.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Game Review missed-tactic markers (Feature 010)', () => {
  beforeEach(async () => {
    chessboardProps.length = 0;
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
  });

  it('renders the classification glyph plus the missed-tactic marker for a verified miss', async () => {
    // 2.g4 is White's blunder and a verified missed tactic (detectionVersion 1).
    await seedCompleted([
      undefined,
      undefined,
      { missedTactic: true, detectionVersion: 1 },
      undefined,
    ]);
    renderReview(null);
    await screen.findByTestId('review-layout');

    const g4 = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!;
    const glyphs = within(g4).getAllByTestId('nag-glyph');
    expect(glyphs).toHaveLength(2);
    // Classification glyph first, preserved; marker NAG 9 (X) added after it.
    expect(glyphs[0]).toHaveAttribute('data-nag', '4');
    expect(glyphs[0]).toHaveTextContent('??');
    expect(glyphs[1]).toHaveAttribute('data-nag', '9');
    expect(glyphs[1]).toHaveTextContent('X');

    // The classification is untouched: g4 is still counted as a user blunder.
    expect(screen.getByTestId('summary-user-blunder-value')).toHaveTextContent('1');

    // Ordinary (good) plies render no classification glyph and no marker.
    for (const san of ['f3', 'e5']) {
      const move = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === san)!;
      expect(within(move).queryByTestId('nag-glyph')).not.toBeInTheDocument();
    }

    // Black's mating best move is not a miss and best moves render quiet: no
    // classification glyph and no marker (R2-3).
    const qh4 = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'Qh4#')!;
    expect(within(qh4).queryByTestId('nag-glyph')).not.toBeInTheDocument();
  });

  it('shows the missed-tactic label when the verified-miss move is active', async () => {
    await seedCompleted([
      undefined,
      undefined,
      { missedTactic: true, detectionVersion: 1 },
      undefined,
    ]);
    renderReview(null);
    await screen.findByTestId('review-layout');

    expect(screen.queryByTestId('review-missed-tactic-label')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!);

    const label = screen.getByTestId('review-missed-tactic-label');
    // Real words, never color-only.
    expect(label).toHaveTextContent('Missed tactic');
    // Explanation text is carried for assistive tech / hover, not just colour.
    expect(label).toHaveAttribute('title', expect.stringContaining('tactic'));
    expect(label).toHaveAttribute('aria-label', expect.stringContaining('tactic'));

    // An ordinary move hides the label again.
    await user.click(screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'f3')!);
    expect(screen.queryByTestId('review-missed-tactic-label')).not.toBeInTheDocument();
  });

  it('shows the review-summary missed-tactic chip for the verified miss', async () => {
    await seedCompleted([
      undefined,
      undefined,
      { missedTactic: true, detectionVersion: 1 },
      undefined,
    ]);
    renderReview(null);
    await screen.findByTestId('review-layout');

    const chip = screen.getByTestId('summary-missed-tactics');
    expect(chip).toHaveTextContent('1 missed tactic');
  });

  it('renders no marker for unverified records (null detectionVersion / missedTactic false)', async () => {
    // A record annotated missedTactic but never verified by a detection pass.
    await seedCompleted([
      undefined,
      undefined,
      { missedTactic: true, detectionVersion: null },
      undefined,
    ]);
    renderReview(null);
    await screen.findByTestId('review-layout');

    const g4 = screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4')!;
    const glyphs = within(g4).getAllByTestId('nag-glyph');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toHaveAttribute('data-nag', '4');
    expect(glyphs.some((glyph) => glyph.dataset.nag === '9')).toBe(false);

    const user = userEvent.setup();
    await user.click(g4);
    expect(screen.queryByTestId('review-missed-tactic-label')).not.toBeInTheDocument();
  });
});

describe('classificationBoardBadges (review board chips)', () => {
  it('maps emphasized classifications to NAG chips on the destination square', () => {
    expect(classificationBoardBadges({ classification: 'blunder', square: 'g4' })).toEqual([
      { square: 'g4', text: '??', color: '#c4261c', kind: 'nag', testId: 'nag-badge' },
    ]);
    expect(classificationBoardBadges({ classification: 'best', square: 'h4' })[0]).toMatchObject({
      square: 'h4',
      text: '!!',
    });
    expect(classificationBoardBadges({ classification: 'inaccuracy', square: 'c5' })[0]?.text).toBe(
      '?!',
    );
    expect(classificationBoardBadges({ classification: 'mistake', square: 'e5' })[0]?.text).toBe(
      '?',
    );
  });

  it('renders no chip for ordinary good moves or missing inputs', () => {
    expect(classificationBoardBadges({ classification: 'good', square: 'f3' })).toEqual([]);
    expect(classificationBoardBadges({ classification: null, square: 'f3' })).toEqual([]);
    expect(classificationBoardBadges({ classification: undefined, square: 'f3' })).toEqual([]);
    expect(classificationBoardBadges({ classification: 'blunder', square: undefined })).toEqual([]);
  });
});
