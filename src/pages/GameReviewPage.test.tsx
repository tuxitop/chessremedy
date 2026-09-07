import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import { defaultGameAnalysisSettings } from '@/components/analysis/gameAnalysisSettings';
import { fixtureGame } from '@/domain/chess/fixtures';
import { createAnalysisJob, markCompleted, markFailed } from '@/domain/analysis';
import { gameAccuracy } from '@/domain/analysis/accuracy';
import { buildAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import { blunderGameRecords } from '@/domain/analysis/fixtures/classificationScenarios';
import { TEST_ENGINE } from '@/domain/analysis/test-support';
import type { EngineMetadata, MoveAnalysis } from '@/domain/chess';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { createFakeAnalysisService } from '@/components/games/test-support/fakeAnalysisService';
import { renderWithProviders } from '@/test/test-utils';
import { GameReviewPage, classificationBoardBadges, plyDestSquare } from '@/pages/GameReviewPage';

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
    await settingsRepository.remove(SETTINGS_KEYS.analysisGame);
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

    // The missed-tactic row is reserved until a detection pass completed.
    expect(screen.queryByTestId('summary-missed-tactics-value')).not.toBeInTheDocument();
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

    // Qh4# is the engine's best move → a quiet ★ chip anchored to h4 (the
    // `!!` glyph is reserved for a future brilliant-move detector).
    await user.click(
      screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'Qh4#')!,
    );
    await waitFor(() =>
      expect(overlayItems()).toEqual([
        { square: 'h4', text: '★', color: '#15781b', kind: 'nag', testId: 'nag-badge' },
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

  it('always offers a Re-analyze action on a completed analysis', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    expect(screen.queryByTestId('review-obsolete')).not.toBeInTheDocument();
    const action = screen.getByTestId('review-reanalyze-action');
    expect(action).toBeInTheDocument();
    expect(action).toHaveTextContent('Re-analyze');
  });

  it('re-analyzing honours the current Game-analysis settings and forces a re-run', async () => {
    // Change the Game-analysis settings to a depth override BEFORE analyzing:
    // the seeded completed run (profile default, no override) must read as
    // "outdated" against the current configuration.
    await settingsRepository.set(SETTINGS_KEYS.analysisGame, {
      ...defaultGameAnalysisSettings(),
      depthOverride: 25,
    });
    await seedCompleted();
    const fake = createFakeAnalysisService();
    renderReview(fake.service);

    // Settings change → the completed run is offered an opt-in re-analysis.
    await screen.findByTestId('review-obsolete');
    const action = screen.getByTestId('review-reanalyze');
    await userEvent.setup().click(action);

    // The forced re-run applies the depth override: a completed job now exists
    // under the new deterministic identity (`maxDepth: 25` in its config).
    await waitFor(async () => {
      const jobs = await analysisJobsRepository.listByGame(GAME.id);
      const configured = jobs.find(
        (job) => job.state === 'completed' && job.config?.maxDepth === 25,
      );
      expect(configured).toBeDefined();
    });

    // The re-run matches the current configuration, so the obsolete banner
    // clears and the completed Review renders again.
    await screen.findByTestId('review-layout');
    await waitFor(() => expect(screen.queryByTestId('review-obsolete')).not.toBeInTheDocument());
  });

  it('shows each player’s accuracy with one decimal', async () => {
    const jobId = await seedCompleted();
    const records = await analysesRepository.listForGameAndAnalysis(GAME.id, jobId);
    const user = gameAccuracy(records, 'white').accuracy;
    const opponent = gameAccuracy(records, 'black').accuracy;
    renderReview(null);
    await screen.findByTestId('review-layout');

    expect(screen.getByTestId('summary-accuracy-user')).toHaveTextContent(`${user!.toFixed(1)}%`);
    expect(screen.getByTestId('summary-accuracy-opponent')).toHaveTextContent(
      `${opponent!.toFixed(1)}%`,
    );
    // The metric label sits in the middle column, centered with the columns.
    expect(screen.getByText('Accuracy')).toBeInTheDocument();
  });

  it('renders the evaluation diagram and seeks a ply on click', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    // One column per analyzed ply, under the board.
    expect(screen.getAllByTestId(/^evaluation-diagram-segment-/)).toHaveLength(4);

    const user = userEvent.setup();
    // Click the 3rd column (2.g4): the board + move list seek to that ply.
    await user.click(screen.getByTestId('evaluation-diagram-segment-2'));
    await waitFor(() =>
      expect(
        screen.getAllByTestId('move-list-move').find((b) => b.dataset.san === 'g4'),
      ).toHaveAttribute('aria-current', 'step'),
    );
  });

  it('relocates the summary below the move list beside the evaluation diagram', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    // The summary now lives inside the side-panel column, after the move list,
    // rather than in the page header above the board.
    const summary = screen.getByTestId('review-summary');
    const layout = screen.getByTestId('review-layout');
    expect(layout).toContainElement(summary);
    const movePane = screen.getByRole('region', { name: 'Moves' });
    expect(movePane.compareDocumentPosition(summary)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('summary-user-head')).toHaveTextContent('chessremedy');
    expect(screen.getByTestId('summary-opponent-head')).toHaveTextContent('bulletpete');
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

  it('shows the review-summary missed-tactic value for the verified miss', async () => {
    await seedCompleted([
      undefined,
      undefined,
      { missedTactic: true, detectionVersion: 1 },
      undefined,
    ]);
    renderReview(null);
    await screen.findByTestId('review-layout');

    const value = screen.getByTestId('summary-missed-tactics-value');
    expect(value).toHaveTextContent('1');
  });

  it('shows a detection-state note instead of a fake zero when the scan has not completed', async () => {
    await seedCompleted();
    renderReview(null);
    await screen.findByTestId('review-layout');

    // No verified-miss record and no summary row → the run is treated as never
    // scanned; the Review says so instead of pretending the count is zero.
    expect(screen.queryByTestId('summary-missed-tactics-value')).not.toBeInTheDocument();
    const note = screen.getByTestId('review-detection-state');
    expect(note).toHaveTextContent('not scanned');
    expect(note).toHaveTextContent('Run the tactics scan');
  });

  it('shows a real zero missed-tactic value once a completed scan found nothing', async () => {
    const jobId = await seedCompleted();
    const records = await analysesRepository.listForGameAndAnalysis(GAME.id, jobId);
    const built = buildAnalysisSummary(records, 'white', {
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: 1,
    });
    await summariesRepository.putForAnalysis({
      analysisId: jobId,
      gameId: GAME.id,
      userColor: 'white',
      updatedAt: Date.now(),
      ...built,
    });

    renderReview(null);
    await screen.findByTestId('review-layout');

    // A completed scan that found nothing is a real zero, not an absent state.
    expect(screen.getByTestId('summary-missed-tactics-value')).toHaveTextContent('0');
    expect(screen.queryByTestId('review-detection-state')).not.toBeInTheDocument();
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
      text: '★',
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

describe('plyDestSquare (badge lands on the king square for castling)', () => {
  it('maps O-O / O-O-O to the king landing square regardless of the stored destination', () => {
    expect(plyDestSquare({ san: 'O-O', color: 'white', to: 'h1' })).toBe('g1');
    expect(plyDestSquare({ san: 'O-O', color: 'black', to: 'h8' })).toBe('g8');
    expect(plyDestSquare({ san: 'O-O-O', color: 'white', to: 'a1' })).toBe('c1');
    expect(plyDestSquare({ san: 'O-O-O', color: 'black', to: 'a8' })).toBe('c8');
  });

  it('keeps the plain destination for ordinary moves and returns undefined without a ply', () => {
    expect(plyDestSquare({ san: 'Nf3', color: 'white', to: 'f3' })).toBe('f3');
    expect(plyDestSquare(undefined)).toBeUndefined();
  });
});

describe('Game Review scan activity bar (plan 012, WP-B)', () => {
  beforeEach(async () => {
    chessboardProps.length = 0;
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.positionAnalysisCache.clear();
  });

  it('offers Run tactics scan for a completed analysis that was never scanned', async () => {
    await seedCompleted();
    const { service } = createFakeAnalysisService();
    renderReview(service);
    await screen.findByTestId('review-layout');

    const bar = await screen.findByTestId('review-scan-bar');
    expect(bar).toHaveTextContent('never scanned');
    expect(within(bar).getByTestId('review-scan-run')).toHaveTextContent('Run tactics scan');
  });

  it('shows a live scan with Cancel while the shown analysis is being scanned', async () => {
    const jobId = await seedCompleted();
    const records = await analysesRepository.listForGameAndAnalysis(GAME.id, jobId);
    const built = buildAnalysisSummary(records, 'white', { detectionState: 'inProgress' });
    await summariesRepository.putForAnalysis({
      analysisId: jobId,
      gameId: GAME.id,
      userColor: 'white',
      updatedAt: Date.now(),
      ...built,
    });

    const base = createFakeAnalysisService().service;
    const cancelScan = vi.fn(async (_id: string): Promise<void> => undefined);
    const service: AnalysisServiceLike = {
      analyzeGames: (ids, profile, run) => base.analyzeGames(ids, profile, run),
      statusesOf: (ids, expected) => base.statusesOf(ids, expected),
      listActiveJobs: () => base.listActiveJobs(),
      cancelGame: (id) => base.cancelGame(id),
      activeDetectionGames: async (): Promise<string[]> => [GAME.id],
      cancelScan,
    };
    renderReview(service);
    await screen.findByTestId('review-layout');

    const bar = await screen.findByTestId('review-scan-bar');
    expect(bar).toHaveTextContent('Tactics scan in progress');
    fireEvent.click(within(bar).getByTestId('review-scan-cancel'));
    await waitFor(() => expect(cancelScan).toHaveBeenCalledWith(GAME.id));
  });

  it('offers Cancel analysis while a job is queued/in progress', async () => {
    await gamesRepository.saveGame(GAME);
    const job = createAnalysisJob(GAME.id, TEST_ENGINE, 4, 1);
    await analysisJobsRepository.putJob(job);
    const service = createFakeAnalysisService().service;
    renderReview(service);

    await waitFor(() =>
      expect(screen.getByTestId('review-state')).toHaveTextContent('Analysis queued'),
    );
    const cancel = await screen.findByTestId('review-cancel-action');
    fireEvent.click(cancel);

    await waitFor(async () => {
      const stored = await analysisJobsRepository.listByGame(GAME.id);
      return stored.every((storedJob) => storedJob.state === 'cancelled');
    });
  });
});
