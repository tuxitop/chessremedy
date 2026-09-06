import { describe, expect, it, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import { gameFromPgn } from '@/domain/chess/parseGame';
import { planGameAnalysis, createAnalysisJob, markCompleted } from '@/domain/analysis';
import { createFakeImportService } from '@/components/games/test-support/fakeImportService';
import { FAKE_ENGINE_META } from '@/infrastructure/analysis/test-support/fakeAnalysisEngine';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import {
  createFakeAnalysisService,
  type FakeAnalysisService,
} from '@/components/games/test-support/fakeAnalysisService';
import { renderWithProviders } from '@/test/test-utils';
import { GamesPage } from './GamesPage';

async function seedGames(ids: string[]): Promise<void> {
  for (const id of ids) {
    await gamesRepository.saveGame(fixtureGame(id));
  }
}

function renderGames(): void {
  const rig = createFakeImportService();
  // Null disables the Feature-008 column without triggering a browser fetch.
  renderWithProviders(<GamesPage service={rig.service} analysisService={null} />, {
    initialEntries: ['/games'],
  });
}

function renderWithAnalysis(fake: FakeAnalysisService): void {
  const rig = createFakeImportService();
  renderWithProviders(<GamesPage service={rig.service} analysisService={fake.service} />, {
    initialEntries: ['/games'],
  });
}

interface HeldAnalysisRig {
  readonly service: AnalysisServiceLike;
  readonly calls: string[][];
  release(): void;
  setStatus(gameId: string, status: string): void;
  setProgress(gameId: string, done: number, total: number): void;
}

/** AnalysisServiceLike that holds every batch until `release`, with scriptable
 *  persisted statuses/progress — lets the queue banner be observed mid-run. */
function createHeldAnalysisService(): HeldAnalysisRig {
  const calls: string[][] = [];
  const waiters: Array<() => void> = [];
  const statuses: Record<string, string> = {};
  const progress: Record<string, { done: number; total: number }> = {};
  const service: AnalysisServiceLike = {
    async analyzeGames(gameIds) {
      calls.push([...gameIds]);
      await new Promise<void>((resolve) => waiters.push(resolve));
      return gameIds.map(() => ({ state: 'completed' })) as never;
    },
    async statusesOf(gameIds) {
      const out: Record<string, string> = {};
      for (const id of gameIds) {
        out[id] = statuses[id] ?? 'unanalyzed';
      }
      return out as never;
    },
    async listActiveJobs() {
      return [];
    },
    async cancelGame(gameId) {
      statuses[gameId] = 'cancelled';
    },
    async jobProgress(gameIds) {
      const out: Record<string, unknown> = {};
      for (const id of gameIds) {
        if (statuses[id] === 'inProgress' && progress[id]) {
          out[id] = {
            state: 'inProgress',
            completedPositions: progress[id]!.done,
            totalPositions: progress[id]!.total,
            profile: 'normal',
          };
        }
      }
      return out as never;
    },
  };
  return {
    service,
    calls,
    release() {
      waiters.shift()?.();
    },
    setStatus(gameId, status) {
      statuses[gameId] = status;
    },
    setProgress(gameId, done, total) {
      progress[gameId] = { done, total };
    },
  };
}

describe('GamesPage (Game Library)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.settings.clear();
  });

  it('shows a distinct empty state when no games are stored', async () => {
    renderGames();
    expect(await screen.findByTestId('library-empty')).toBeInTheDocument();
  });

  it('lists stored games newest-first and filters by platform, search and clear-all', async () => {
    await seedGames(['cc-blitz-clean', 'li-rapid-clean']);
    renderGames();

    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
    expect(screen.getByTestId('library-count')).toHaveTextContent('2 of 2 games');

    const user = userEvent.setup();
    // Platform filter → Lichess only.
    await user.selectOptions(screen.getByTestId('filter-platform'), 'lichess');
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId('game-source')).toHaveTextContent('Lichess');

    // Search (opponent) narrows further.
    await user.type(screen.getByTestId('library-search'), 'eagereddie');
    await waitFor(() => expect(screen.queryAllByTestId('game-row')).toHaveLength(0));
    expect(screen.getByTestId('library-no-match')).toBeInTheDocument();

    // Clearing search keeps the platform filter.
    await user.click(screen.getByTestId('library-search-clear'));
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));

    // Clear-all removes the platform filter too.
    await user.click(screen.getByTestId('filter-clear-all'));
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
  });

  it('selects rows, shows the bulk bar, and deletes with confirmation', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    const blitz = fixtureGame('cc-blitz-clean');
    await seedGames(['cc-bullet-blunder', 'cc-blitz-clean']);
    renderGames();

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    await user.click(screen.getByTestId(`game-select-${bullet.id}`));
    expect(screen.getByTestId('library-selection-bar')).toHaveTextContent('Selected: 1');
    expect(screen.getByTestId('library-analyze')).toBeDisabled();

    // Cancel keeps the games.
    await user.click(screen.getByTestId('library-delete'));
    await user.click(screen.getByTestId('delete-cancel'));
    expect(await gamesRepository.countGames()).toBe(2);

    // Confirming deletes the selected game from the database.
    await user.click(screen.getByTestId('library-delete'));
    await user.click(screen.getByTestId('delete-confirm'));
    await waitFor(async () => expect(await gamesRepository.countGames()).toBe(1));
    expect(await gamesRepository.hasGame(bullet.id)).toBe(false);
    expect(await gamesRepository.hasGame(blitz.id)).toBe(true);
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
  });

  it('select-all operates on the current filtered result set', async () => {
    await seedGames(['cc-bullet-blunder', 'cc-blitz-clean']);
    renderGames();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    await user.click(screen.getByTestId('library-select-all'));
    expect(screen.getByTestId('library-selection-bar')).toHaveTextContent('Selected: 2');
  });

  it('paginates the result set and honours the chosen page size', async () => {
    const many: string[] = [];
    for (let index = 0; index < 55; index += 1) {
      const day = (index % 27) + 1;
      const date = `2026.03.${day.toString().padStart(2, '0')}`;
      const pgn = `[Event "p ${index}"]\n[Date "${date}"]\n[White "w${index}"]\n[Black "b${index}"]\n[Result "1-0"]\n[TimeControl "300"]\n\n1. e4 e5 1-0`;
      many.push(pgn);
    }
    const parsed = many.map((pgn) => {
      const result = gameFromPgn(pgn, { source: 'local', userColor: 'white' });
      if (!result.ok) throw new Error(result.error.message);
      return result.game;
    });
    await gamesRepository.saveGames(parsed);
    renderGames();

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(50));
    expect(screen.getByTestId('library-page-status')).toHaveTextContent('Page 1 of 2');
    expect(screen.getByTestId('library-page-prev')).toBeDisabled();

    await user.click(screen.getByTestId('library-page-next'));
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(5));
    expect(screen.getByTestId('library-page-status')).toHaveTextContent('Page 2 of 2');
    expect(screen.getByTestId('library-page-next')).toBeDisabled();

    await user.selectOptions(screen.getByTestId('library-page-size'), '100');
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(55));
    expect(screen.getByTestId('library-page-status')).toHaveTextContent('Page 1 of 1');
  });

  it('clears the selection when filters change', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    await seedGames(['cc-bullet-blunder', 'cc-blitz-clean']);
    renderGames();

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
    await user.click(screen.getByTestId(`game-select-${bullet.id}`));
    expect(screen.getByTestId('library-selection-bar')).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('filter-side'), 'white');
    await waitFor(() =>
      expect(screen.queryByTestId('library-selection-bar')).not.toBeInTheDocument(),
    );
  });

  it('does not error while a custom range is incomplete and filters once valid', async () => {
    await seedGames(['cc-bullet-blunder', 'cc-blitz-clean']);
    renderGames();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    // Selecting Custom with empty dates must not raise a load error.
    await user.selectOptions(screen.getByTestId('filter-time'), 'custom');
    await waitFor(() => expect(screen.queryByTestId('library-error')).not.toBeInTheDocument());
    expect(screen.getAllByTestId('game-row')).toHaveLength(2);
    expect(screen.getByTestId('filter-custom-range')).toHaveTextContent(
      'Choose both a start and an end date.',
    );

    // Completing a valid range runs the query without an error.
    fireEvent.change(screen.getByTestId('filter-date-from'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByTestId('filter-date-to'), {
      target: { value: '2027-12-31' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('filter-custom-range')).not.toHaveTextContent(
        'Choose both a start and an end date.',
      ),
    );
    expect(screen.queryByTestId('library-error')).not.toBeInTheDocument();
  });
});

describe('GamesPage analysis workflow (Feature 008)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
  });

  it('analyzes a selected game and exposes Review once completed', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(bullet);
    const fake = createFakeAnalysisService();
    renderWithAnalysis(fake);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId(`game-analysis-${bullet.id}`)).toHaveAttribute(
      'data-status',
      'unanalyzed',
    );

    await user.click(screen.getByTestId(`game-select-${bullet.id}`));
    await user.click(screen.getByTestId('library-analyze'));

    await waitFor(
      () => expect(screen.getByTestId(`game-review-${bullet.id}`)).toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(await analysesRepository.countForGame(bullet.id)).toBe(4);
  });

  it('surfaces a failed analysis and retries it to completion', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const plan = planGameAnalysis(game);
    if (!plan.ok) throw new Error(plan.message);
    const failingFen = plan.plan.analyzeFens[0]!;

    const fake = createFakeAnalysisService(new Map([[failingFen, 'Engine crashed']]));
    renderWithAnalysis(fake);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    await user.click(screen.getByTestId(`game-select-${game.id}`));
    await user.click(screen.getByTestId('library-analyze'));

    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'failed',
      ),
    );
    expect(await analysisJobsRepository.listByGame(game.id)).toHaveLength(1);

    // Retry after the engine recovers completes the same job identity.
    fake.engine.clearFailures();
    screen.getByTestId(`game-retry-${game.id}`);
    await user.click(screen.getByTestId(`game-retry-${game.id}`));
    await waitFor(() => expect(screen.getByTestId(`game-review-${game.id}`)).toBeInTheDocument(), {
      timeout: 8000,
    });
  });

  it('marks an analysis as outdated and re-analyzes it under the current engine', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);

    // A completed analysis produced by an older engine build.
    const older = createAnalysisJob(
      game.id,
      {
        engineName: 'stockfish',
        engineVersion: '17.0.0',
        engineBuild: 'stockfish-17-lite-single',
        profile: 'normal',
      },
      14,
      1,
    );
    await analysisJobsRepository.putJob(markCompleted(older, 2));

    const fake = createFakeAnalysisService();
    renderWithAnalysis(fake);

    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'outdated',
      ),
    );
    expect(screen.getByTestId(`game-reanalyze-${game.id}`)).toBeInTheDocument();

    await user.click(screen.getByTestId(`game-reanalyze-${game.id}`));
    await waitFor(async () => expect(await analysesRepository.countForGame(game.id)).toBe(14));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'completed',
      ),
    );
    expect(screen.getByTestId(`game-review-${game.id}`)).toBeInTheDocument();
  });

  it('shows per-game progress and cancels a single queued/in-progress game', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);

    // A persisted in-progress job (2 of 4 positions) under the current engine.
    const job = createAnalysisJob(game.id, FAKE_ENGINE_META, 4, 1);
    await analysisJobsRepository.putJob({
      ...job,
      state: 'inProgress',
      completedPositions: 2,
      startedAt: 1,
    });

    const fake = createFakeAnalysisService();
    renderWithAnalysis(fake);

    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'inProgress',
      ),
    );

    // Per-row progress: current/total positions, percentage and profile.
    const progress = screen.getByTestId(`game-progress-${game.id}`);
    expect(progress).toHaveTextContent('2/4 positions');
    expect(progress).toHaveTextContent('50%');
    expect(progress).toHaveTextContent('normal');

    // Per-row cancel marks the game cancelled (other games would continue).
    await user.click(screen.getByTestId(`game-cancel-${game.id}`));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'cancelled',
      ),
    );
    expect((await analysisJobsRepository.listByGame(game.id))[0]!.state).toBe('cancelled');
  });

  it('renders a full-width progress bar driven by completed/total positions', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);
    const job = createAnalysisJob(game.id, FAKE_ENGINE_META, 4, 1);
    await analysisJobsRepository.putJob({
      ...job,
      state: 'inProgress',
      completedPositions: 1,
      startedAt: 1,
    });

    const fake = createFakeAnalysisService();
    renderWithAnalysis(fake);

    await waitFor(() =>
      expect(screen.getByTestId(`game-progress-bar-${game.id}`)).toBeInTheDocument(),
    );
    const bar = screen.getByTestId(`game-progress-bar-${game.id}`);
    expect(bar).toHaveAttribute('role', 'progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByTestId(`game-progress-fill-${game.id}`)).toHaveStyle({ width: '25%' });
  });

  it('bulk Re-analyze is enabled only when the selection has a completed/outdated run', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);

    const fake = createFakeAnalysisService();
    renderWithAnalysis(fake);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    await user.click(screen.getByTestId(`game-select-${game.id}`));
    // Unanalyzed selection → Re-analyze is disabled.
    expect(screen.getByTestId('library-reanalyze')).toBeDisabled();

    // Analyze → completed → the same selection enables Re-analyze.
    await user.click(screen.getByTestId('library-analyze'));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'completed',
      ),
    );
    expect(screen.getByTestId('library-reanalyze')).toBeEnabled();
  });

  it('bulk Re-analyze force-re-runs completed selections', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);

    const fake = createFakeAnalysisService();
    renderWithAnalysis(fake);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    await user.click(screen.getByTestId(`game-select-${game.id}`));
    await user.click(screen.getByTestId('library-analyze'));

    // Wait for the run to persist its records and surface `completed`.
    await waitFor(async () => expect(await analysesRepository.countForGame(game.id)).toBe(14));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'completed',
      ),
    );

    // A plain analyze on a completed game is a no-op; bulk Re-analyze reruns.
    await user.click(screen.getByTestId('library-reanalyze'));
    await waitFor(async () => expect(await analysesRepository.countForGame(game.id)).toBe(14));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'completed',
      ),
    );
    expect(screen.getByTestId(`game-review-${game.id}`)).toBeInTheDocument();
  });

  it('shows the queue banner, counts queued games and clears when the queue drains', async () => {
    const bullet = fixtureGame('cc-bullet-blunder');
    const blitz = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGames([bullet, blitz]);

    const held = createHeldAnalysisService();
    const rig = createFakeImportService();
    renderWithProviders(<GamesPage service={rig.service} analysisService={held.service} />, {
      initialEntries: ['/games'],
    });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    // Analyze the first game; the engine is held so the run stays visible.
    await user.click(screen.getByTestId(`game-select-${bullet.id}`));
    await user.click(screen.getByTestId('library-analyze'));
    await waitFor(() => expect(held.calls).toEqual([[bullet.id]]));

    act(() => {
      held.setStatus(bullet.id, 'inProgress');
      held.setProgress(bullet.id, 2, 4);
    });
    const banner = () => screen.getByTestId('library-progress');
    await waitFor(() => expect(banner()).toHaveTextContent('Analyzing 1 of 1 games'));
    await waitFor(() => expect(screen.getByTestId('library-progress-bar')).toBeInTheDocument());
    const bar = screen.getByTestId('library-progress-bar');
    expect(bar).toHaveAttribute('role', 'progressbar');
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
    expect(screen.getByTestId('library-progress-fill')).toHaveStyle({ width: '50%' });

    // Queue a second game while the first runs → the banner widens to 1 of 2
    // and the queued row exposes a per-row cancel. Analyze the *selection*, so
    // clear the first game's checkbox first.
    await user.click(screen.getByTestId(`game-select-${bullet.id}`));
    await user.click(screen.getByTestId(`game-select-${blitz.id}`));
    await user.click(screen.getByTestId('library-analyze'));
    await waitFor(() => expect(held.calls).toEqual([[bullet.id]])); // not started yet
    await waitFor(() => expect(banner()).toHaveTextContent('Analyzing 1 of 2 games'));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${blitz.id}`)).toHaveAttribute(
        'data-status',
        'queued',
      ),
    );

    // Cancel the queued game: it is pulled out of the queue and never runs.
    await user.click(screen.getByTestId(`game-cancel-${blitz.id}`));
    await waitFor(() => expect(banner()).toHaveTextContent('Analyzing 1 of 1 games'));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${blitz.id}`)).toHaveAttribute(
        'data-status',
        'unanalyzed',
      ),
    );

    // The active game finishes → the banner disappears (nothing left queued).
    act(() => {
      held.setStatus(bullet.id, 'completed');
    });
    act(() => held.release());
    await waitFor(() => expect(held.calls).toEqual([[bullet.id]]));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${bullet.id}`)).toHaveAttribute(
        'data-status',
        'completed',
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('library-progress')).not.toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('deletes a single game from its per-row delete action with confirmation', async () => {
    const a = fixtureGame('cc-bullet-blunder');
    const b = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGames([a, b]);

    const fake = createFakeAnalysisService();
    renderWithAnalysis(fake);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));

    // Per-row delete opens the dialog for that one game; cancelling keeps it.
    await user.click(screen.getByTestId(`game-delete-${a.id}`));
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 1 game?');
    await user.click(screen.getByTestId('delete-cancel'));
    expect(await gamesRepository.countGames()).toBe(2);

    // Confirming removes only that game.
    await user.click(screen.getByTestId(`game-delete-${a.id}`));
    await user.click(screen.getByTestId('delete-confirm'));
    await waitFor(async () => expect(await gamesRepository.countGames()).toBe(1));
    expect(await gamesRepository.hasGame(a.id)).toBe(false);
    expect(await gamesRepository.hasGame(b.id)).toBe(true);
  });

  it('shows a colored status badge instead of plain text for non-trivial states', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);
    const older = createAnalysisJob(
      game.id,
      {
        engineName: 'stockfish',
        engineVersion: '17.0.0',
        engineBuild: 'stockfish-17-lite-single',
        profile: 'normal',
      },
      4,
      1,
    );
    await analysisJobsRepository.putJob(markCompleted(older, 2));

    renderWithAnalysis(createFakeAnalysisService());

    const badge = await screen.findByTestId(`game-status-${game.id}`);
    // The badge carries an accessible name spelling out the state + info.
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('Outdated'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('Re-analyze'));

    // Tapping (touch) reveals the explanatory text.
    await userEvent.setup().click(badge);
    expect(screen.getByTestId(`game-status-info-${game.id}`)).toHaveTextContent('Outdated');
  });

  it('renders no status badge for completed or unanalyzed rows', async () => {
    const a = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(a);
    await analysisJobsRepository.putJob(
      markCompleted(createAnalysisJob(a.id, FAKE_ENGINE_META, 4, 1), 2),
    );
    const bare = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(bare);

    renderWithAnalysis(createFakeAnalysisService());

    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
    expect(screen.queryByTestId(`game-status-${a.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`game-status-${bare.id}`)).not.toBeInTheDocument();
  });

  it('reveals the status explanation on hover (desktop) for a badge', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);
    const older = createAnalysisJob(
      game.id,
      {
        engineName: 'stockfish',
        engineVersion: '17.0.0',
        engineBuild: 'stockfish-17-lite-single',
        profile: 'normal',
      },
      4,
      1,
    );
    await analysisJobsRepository.putJob(markCompleted(older, 2));

    renderWithAnalysis(createFakeAnalysisService());

    const badge = await screen.findByTestId(`game-status-${game.id}`);
    expect(screen.queryByTestId(`game-status-info-${game.id}`)).not.toBeInTheDocument();

    await userEvent.setup().hover(badge);
    expect(screen.getByTestId(`game-status-info-${game.id}`)).toHaveTextContent('Outdated');

    // Leaving the badge hides the explanation again.
    fireEvent.mouseLeave(badge);
    expect(screen.queryByTestId(`game-status-info-${game.id}`)).not.toBeInTheDocument();
  });
});
