import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import { fixtureGame } from '@/domain/chess/fixtures';
import {
  analysisJobId,
  createAnalysisJob,
  markCancelled,
  markCompleted,
  markFailed,
  markInProgress,
  type AnalysisJob,
} from '@/domain/analysis';
import { makeEngine, TEST_ENGINE } from '@/domain/analysis/test-support';
import type { EngineMetadata } from '@/domain/chess';
import type { Game } from '@/domain/chess/game';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import { createFakeAnalysisService } from '@/components/games/test-support/fakeAnalysisService';
import { renderWithProviders } from '@/test/test-utils';
import { GameLibrary } from './GameLibrary';

const NOW = 1_700_000_000_000;

async function seedJob(
  gameId: string,
  state: AnalysisJob['state'],
  options: {
    readonly engine?: EngineMetadata;
    readonly versions?: { readonly analysisVersion?: number };
  } = {},
): Promise<AnalysisJob> {
  const engine = options.engine ?? TEST_ENGINE;
  const base = createAnalysisJob(gameId, engine, 2, NOW);
  const job =
    options.versions === undefined
      ? base
      : {
          ...base,
          id: analysisJobId(gameId, engine, options.versions),
          analysisVersion: options.versions.analysisVersion ?? base.analysisVersion,
        };
  const terminal =
    state === 'completed'
      ? markCompleted(job, NOW + 1)
      : state === 'failed'
        ? markFailed(job, 'engine error', NOW + 1)
        : state === 'cancelled'
          ? markCancelled(job, NOW + 1)
          : state === 'inProgress'
            ? markInProgress(job, NOW + 1)
            : job;
  await analysisJobsRepository.putJob(terminal);
  return terminal;
}

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

/** Save the game, complete an analysis under the current engine and attach a summary. */
async function seedAnalyzedGame(gameId: string, overrides: SummaryOverrides = {}): Promise<Game> {
  const game = fixtureGame(gameId);
  await gamesRepository.saveGame(game);
  const job = await seedJob(game.id, 'completed');
  await summariesRepository.putForAnalysis(summaryRowFor(job.id, game, overrides));
  return game;
}

function renderLibrary(): void {
  renderWithProviders(<GameLibrary refreshKey={0} />, { initialEntries: ['/games'] });
}

describe('GameLibrary row insights strip (Feature 010)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
  });

  it('shows Accuracy, error counts and the missed-tactic count for a completed analysis', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 4, good: 2, inaccuracy: 4, mistake: 3, blunder: 2 },
      userMoves: 9,
      totalMoves: 18,
      accuracy: 78,
      accuracyMoves: 9,
      detectionState: 'completed',
      missedTacticCount: 1,
      detectionVersion: DETECTION_VERSION,
    });
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-accuracy')).toHaveTextContent('Accuracy 78.0%');
    expect(within(strip).getByTestId('row-insights-blunders')).toHaveTextContent('Blunders 2');
    expect(within(strip).getByTestId('row-insights-mistakes')).toHaveTextContent('Mistakes 3');
    expect(within(strip).getByTestId('row-insights-inaccuracies')).toHaveTextContent(
      'Inaccuracies 4',
    );
    expect(within(strip).getByTestId('row-insights-missed-tactics')).toHaveTextContent(
      'Missed tactics 1',
    );
    expect(strip).toHaveAttribute(
      'aria-label',
      'Accuracy 78.0 per cent, 2 blunders, 3 mistakes, 4 inaccuracies, 1 missed tactic',
    );
  });

  it('renders the strip for an outdated analysis (older completed run still visible)', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    const job = await seedJob(game.id, 'completed', { versions: { analysisVersion: 0 } });
    await summariesRepository.putForAnalysis(
      summaryRowFor(job.id, game, {
        classificationCounts: { best: 5, good: 1, inaccuracy: 1, mistake: 0, blunder: 0 },
        userMoves: 6,
        totalMoves: 12,
        accuracy: 61,
        accuracyMoves: 6,
        detectionState: 'completed',
        missedTacticCount: 0,
        detectionVersion: DETECTION_VERSION,
      }),
    );
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-accuracy')).toHaveTextContent('Accuracy 61.0%');
    expect(within(strip).getByTestId('row-insights-blunders')).toHaveTextContent('Blunders 0');
    expect(within(strip).getByTestId('row-insights-missed-tactics')).toHaveTextContent(
      'Missed tactics 0',
    );
  });

  it('renders no strip for unanalyzed, queued, in-progress, cancelled and failed games', async () => {
    const unanalyzed = fixtureGame('cc-bullet-blunder');
    const queued = fixtureGame('cc-blitz-clean');
    const inProgress = fixtureGame('cc-rapid-missed-tactic');
    const cancelled = fixtureGame('cc-classical-endgame');
    const failed = fixtureGame('li-bullet-missed-mate');
    await gamesRepository.saveGames([unanalyzed, queued, inProgress, cancelled, failed]);
    await seedJob(queued.id, 'queued');
    await seedJob(inProgress.id, 'inProgress');
    await seedJob(cancelled.id, 'cancelled');
    await seedJob(failed.id, 'failed');
    renderLibrary();

    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(5));
    for (const id of [unanalyzed, queued, inProgress, cancelled, failed].map((game) => game.id)) {
      expect(screen.queryByTestId(`row-insights-${id}`)).not.toBeInTheDocument();
    }
  });

  it('hides the strip while a newer re-analysis is queued over a completed run', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);
    const older = await seedJob(game.id, 'completed', { engine: makeEngine('deep') });
    await summariesRepository.putForAnalysis(
      summaryRowFor(older.id, game, {
        classificationCounts: { best: 4, good: 2, inaccuracy: 1, mistake: 1, blunder: 1 },
        accuracy: 72,
        detectionState: 'completed',
        missedTacticCount: 1,
        detectionVersion: DETECTION_VERSION,
      }),
    );
    await seedJob(game.id, 'queued');
    renderLibrary();

    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.queryByTestId(`row-insights-${game.id}`)).not.toBeInTheDocument();
  });

  it('renders Blunders 0 when counts exist and omits Missed tactics before a detection pass', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 10, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      userMoves: 10,
      totalMoves: 20,
      accuracy: 91,
      accuracyMoves: 10,
      detectionState: 'queued',
    });
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-blunders')).toHaveTextContent('Blunders 0');
    expect(within(strip).queryByTestId('row-insights-missed-tactics')).not.toBeInTheDocument();
  });

  it('shows Missed tactics 0 only when the detection pass completed', async () => {
    const game = await seedAnalyzedGame('li-blitz-blunder', {
      classificationCounts: { best: 8, good: 1, inaccuracy: 1, mistake: 0, blunder: 0 },
      accuracy: 55,
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: DETECTION_VERSION,
    });
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-missed-tactics')).toHaveTextContent(
      'Missed tactics 0',
    );
    expect(within(strip).getByTestId('row-insights-inaccuracies')).toHaveTextContent(
      'Inaccuracies 1',
    );
  });

  it('labels a completed run that was never scanned instead of hiding it', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 10, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      accuracy: 91,
      detectionState: 'absent',
    });
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).queryByTestId('row-insights-missed-tactics')).not.toBeInTheDocument();
    expect(within(strip).getByTestId('row-insights-detection-absent')).toHaveTextContent(
      'Tactics not scanned',
    );
  });

  it('labels interrupted and failed scans instead of a silent absence', async () => {
    // A persisted queued/in-progress summary with no live scan in this session
    // is an interrupted pass — never shown as if a scan were running.
    const queued = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: 70,
      detectionState: 'queued',
    });
    const failed = await seedAnalyzedGame('li-blitz-blunder', {
      classificationCounts: { best: 2, good: 1, inaccuracy: 0, mistake: 0, blunder: 0 },
      accuracy: 64,
      detectionState: 'failed',
    });
    renderLibrary();

    const interruptedStrip = await screen.findByTestId(`row-insights-${queued.id}`);
    expect(
      within(interruptedStrip).getByTestId('row-insights-detection-interrupted'),
    ).toHaveTextContent('Tactics scan interrupted');

    const failedStrip = await screen.findByTestId(`row-insights-${failed.id}`);
    expect(within(failedStrip).getByTestId('row-insights-detection-failed')).toHaveTextContent(
      'Tactics scan failed',
    );
  });

  it('omits the Accuracy item when the completed analysis has no usable accuracy', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: null,
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: DETECTION_VERSION,
    });
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).queryByTestId('row-insights-accuracy')).not.toBeInTheDocument();
    expect(within(strip).getByTestId('row-insights-blunders')).toHaveTextContent('Blunders 1');
  });
});

describe('GameLibrary analysis-result filters (Feature 010)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
  });

  it('offers the three labelled filters with the canonical options and narrows the rows', async () => {
    const analyzed = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 1, inaccuracy: 1, mistake: 0, blunder: 2 },
      accuracy: 70,
      detectionState: 'completed',
      missedTacticCount: 1,
      detectionVersion: DETECTION_VERSION,
    });
    const pending = fixtureGame('li-rapid-clean');
    await gamesRepository.saveGame(pending);
    const pendingJob = await seedJob(pending.id, 'completed');
    await summariesRepository.putForAnalysis(
      summaryRowFor(pendingJob.id, pending, {
        classificationCounts: { best: 2, good: 2, inaccuracy: 0, mistake: 0, blunder: 0 },
        accuracy: 64,
        detectionState: 'queued',
      }),
    );
    const bare = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(bare);
    renderLibrary();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(3));

    const analysis = screen.getByTestId('filter-analysis');
    const blunders = screen.getByTestId('filter-has-blunders');
    const missed = screen.getByTestId('filter-has-missed-tactics');
    expect(analysis).toHaveValue('all');
    expect(blunders).toHaveValue('all');
    expect(missed).toHaveValue('all');
    expect(optionLabels(analysis)).toEqual(['All', 'Analyzed', 'Not analyzed']);
    expect(optionLabels(blunders)).toEqual(['All', 'Yes', 'No']);
    expect(optionLabels(missed)).toEqual(['All', 'Yes', 'No']);

    // "Analyzed" matches completed/outdated runs only (never unanalyzed).
    await user.selectOptions(analysis, 'analyzed');
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(2));
    expect(analysis).toHaveValue('analyzed');
    expect(screen.getByTestId(`game-select-${analyzed.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`game-select-${pending.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`game-select-${bare.id}`)).not.toBeInTheDocument();

    // The blunder dimension ANDs: only analyzed games with ≥ 1 user blunder.
    await user.selectOptions(blunders, 'yes');
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId(`game-select-${analyzed.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`game-select-${pending.id}`)).not.toBeInTheDocument();

    // Missed-tactics "no" must not match the analyzed-but-undetected game
    // (absent ≠ zero), so the combination matches nothing → the no-match state.
    await user.selectOptions(missed, 'no');
    await waitFor(() => expect(screen.getByTestId('library-no-match')).toBeInTheDocument());
    expect(screen.queryByTestId('game-row')).not.toBeInTheDocument();

    // The completed detection pass does match "yes".
    await user.selectOptions(missed, 'yes');
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId(`game-select-${analyzed.id}`)).toBeInTheDocument();

    // "Not analyzed" inverts the analysis dimension (bare stays, others leave).
    await user.selectOptions(blunders, 'all');
    await user.selectOptions(missed, 'all');
    await user.selectOptions(analysis, 'notAnalyzed');
    // Both the previous ("analyzed") and the next ("not analyzed") filters show
    // one row, so wait on the actual row change — never just the count, which
    // could pass on the stale row set before the reload lands.
    await waitFor(() => {
      expect(screen.queryByTestId(`game-select-${analyzed.id}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`game-select-${pending.id}`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`game-select-${bare.id}`)).toBeInTheDocument();
    });
  });
});

function optionLabels(select: Element): readonly string[] {
  return [...select.querySelectorAll('option')].map((option) => option.textContent?.trim() ?? '');
}

/** Scriptable fake with the WP-A on-demand scan surface + live detection set. */
function serviceWithScan(): AnalysisServiceLike & {
  scanCalls: string[];
  scanCancels: string[];
  scanning: Set<string>;
} {
  const scanCalls: string[] = [];
  const scanCancels: string[] = [];
  const scanning = new Set<string>();
  return {
    scanCalls,
    scanCancels,
    scanning,
    async statusesOf(gameIds): Promise<Readonly<Record<string, GameAnalysisStatus>>> {
      const out: Record<string, GameAnalysisStatus> = {};
      for (const id of gameIds) {
        const jobs = await analysisJobsRepository.listByGame(id);
        const state = jobs.map((job) => job.state);
        out[id] = state.includes('completed')
          ? 'completed'
          : state.includes('queued')
            ? 'queued'
            : state.includes('inProgress')
              ? 'inProgress'
              : 'unanalyzed';
      }
      return out;
    },
    async listActiveJobs() {
      return [];
    },
    async analyzeGames(gameIds) {
      return gameIds.map((gameId) =>
        markCompleted(createAnalysisJob(gameId, TEST_ENGINE, 0, 1), 2),
      );
    },
    async jobProgress(gameIds) {
      const out: Record<string, undefined> = {};
      for (const id of gameIds) out[id] = undefined;
      return out;
    },
    async cancelGame() {},
    async activeDetectionGames() {
      return [...scanning];
    },
    async liveAnalysisGames() {
      return [];
    },
    async scanGame(gameId) {
      scanCalls.push(gameId);
      scanning.add(gameId);
      return 'started';
    },
    async cancelScan(gameId) {
      scanCancels.push(gameId);
      scanning.delete(gameId);
    },
  };
}

describe('GameLibrary resumable scans + persistent engine activity (plan 012, WP-B)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
  });

  it('offers a Resume action for an interrupted scan and flips it to scanning', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: 70,
      detectionState: 'queued',
    });
    const service = serviceWithScan();
    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-detection-interrupted')).toHaveTextContent(
      'Tactics scan interrupted',
    );
    const resume = await screen.findByTestId(`row-scan-resume-${game.id}`);
    fireEvent.click(resume);

    await waitFor(() => expect(service.scanCalls).toEqual([game.id]));
    // The scan is registered live: the strip now reads "in progress" and the
    // Resume affordance is gone (no double-scan affordance while scanning).
    await waitFor(() =>
      expect(within(strip).getByTestId('row-insights-detection-pending')).toHaveTextContent(
        'Tactics scan in progress…',
      ),
    );
    expect(screen.queryByTestId(`row-scan-resume-${game.id}`)).not.toBeInTheDocument();
  });

  it('shows the distinct-colour tactics-scan progress bar while the pass is live (plan 013 W3)', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: 70,
      detectionState: 'inProgress',
      scanProgress: { done: 2, total: 4 },
    });
    const service = serviceWithScan();
    service.scanning.add(game.id);
    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    // The live-scan bar carries the numeric progress with the numbers spelled
    // out (a11y) and the strip keeps its "scanning" note (never a silent zero).
    const progress = await screen.findByTestId(`game-scan-progress-${game.id}`);
    expect(progress).toHaveAttribute('role', 'progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '50');
    expect(progress).toHaveAttribute('aria-label', 'Verifying tactic 2 of 4, 50 per cent');
    expect(within(progress).getByTestId(`game-scan-progress-text-${game.id}`)).toHaveTextContent(
      'Verifying tactic 2 of 4 · 50%',
    );

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-detection-pending')).toHaveTextContent(
      'Tactics scan in progress…',
    );

    // The persistent engine-activity banner aggregates the running scan.
    const banner = await screen.findByTestId('library-engine-busy-line');
    expect(banner).toHaveTextContent('1 tactics scan running');
    expect(banner).toHaveTextContent('2/4 candidates verified');
  });

  it('never claims scan progress for an interrupted (non-live) pass', async () => {
    // A persisted `inProgress` summary with recorded progress but no live owner
    // reads as interrupted: no bar is drawn over it.
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: 70,
      detectionState: 'inProgress',
      scanProgress: { done: 2, total: 4 },
    });
    const service = serviceWithScan();
    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-detection-interrupted')).toHaveTextContent(
      'Tactics scan interrupted',
    );
    expect(screen.queryByTestId(`game-scan-progress-${game.id}`)).not.toBeInTheDocument();
  });

  it('offers Run/Retry actions for absent/failed detection and hides them while live', async () => {
    const absent = await seedAnalyzedGame('cc-blitz-clean', {
      classificationCounts: { best: 4, good: 2, inaccuracy: 1, mistake: 1, blunder: 1 },
      accuracy: 80,
      detectionState: 'absent',
    });
    const failed = await seedAnalyzedGame('li-blitz-blunder', {
      classificationCounts: { best: 2, good: 1, inaccuracy: 0, mistake: 0, blunder: 0 },
      accuracy: 64,
      detectionState: 'failed',
    });
    const service = serviceWithScan();
    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    expect(await screen.findByTestId(`row-scan-run-${absent.id}`)).toBeInTheDocument();
    expect(await screen.findByTestId(`row-scan-retry-${failed.id}`)).toBeInTheDocument();
  });

  it('offers a Refresh scan for a completed detection from an older version (plan 015)', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: 70,
      detectionState: 'completed',
      missedTacticCount: 1,
      detectionVersion: 1,
    });
    const service = serviceWithScan();
    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    // A stale completed result is never presented as a real missed-tactic
    // count; the strip explains it is out of date instead.
    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-detection-outdated')).toHaveTextContent(
      'Tactics scan out of date',
    );
    expect(within(strip).queryByTestId('row-insights-missed-tactics')).not.toBeInTheDocument();

    const refresh = await screen.findByTestId(`row-scan-refresh-${game.id}`);
    fireEvent.click(refresh);
    await waitFor(() => expect(service.scanCalls).toEqual([game.id]));
  });

  it('marks a persisted queued analysis job from an earlier session as paused (no auto-run)', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);
    await seedJob(game.id, 'queued');
    const service = serviceWithScan();
    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    // Not live this session and not driven by the hook's own queue → paused:
    // an explicit Resume affordance is shown, never silent background work.
    expect(await screen.findByTestId(`game-resume-${game.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`game-cancel-${game.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`game-status-${game.id}`)).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Paused'),
    );
    // A paused row is never shown as busy engine work.
    expect(screen.queryByTestId('library-engine-busy')).not.toBeInTheDocument();
  });

  it('shows a persistent engine-activity banner while a tactics scan is running', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: 70,
      detectionState: 'queued',
    });
    const service = serviceWithScan();
    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    const resume = await screen.findByTestId(`row-scan-resume-${game.id}`);
    fireEvent.click(resume);

    const banner = await screen.findByTestId('library-engine-busy');
    expect(banner).toHaveTextContent('1 tactics scan running');

    // Cancel work aborts the scan and the banner clears once the poll observes
    // the (now empty) live registry (the detection poll ticks every 2 s).
    fireEvent.click(screen.getByTestId('library-engine-busy-cancel'));
    await waitFor(() => expect(service.scanCancels).toEqual([game.id]));
    await waitFor(
      () => expect(screen.queryByTestId('library-engine-busy')).not.toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});

describe('GameLibrary summary backfill (Feature 010 polish)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
  });

  function serviceWithBackfill(): AnalysisServiceLike & { backfillCalls: string[][] } {
    const backfillCalls: string[][] = [];
    return {
      backfillCalls,
      async statusesOf(gameIds): Promise<Readonly<Record<string, GameAnalysisStatus>>> {
        const out: Record<string, GameAnalysisStatus> = {};
        for (const id of gameIds) {
          const jobs = await analysisJobsRepository.listByGame(id);
          out[id] = jobs.some((job) => job.state === 'completed') ? 'completed' : 'unanalyzed';
        }
        return out;
      },
      async listActiveJobs() {
        return [];
      },
      async analyzeGames(gameIds) {
        return gameIds.map((gameId) =>
          markCompleted(createAnalysisJob(gameId, TEST_ENGINE, 0, 1), 2),
        );
      },
      async jobProgress(gameIds) {
        const out: Record<string, undefined> = {};
        for (const id of gameIds) out[id] = undefined;
        return out;
      },
      async cancelGame() {},
      async ensureSummariesForRows(gameIds) {
        backfillCalls.push([...gameIds]);
        for (const gameId of gameIds) {
          const jobs = await analysisJobsRepository.listByGame(gameId);
          const completed = jobs
            .filter((job) => job.state === 'completed')
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const game = (await gamesRepository.getGame(gameId))!;
          if (completed) {
            await summariesRepository.putForAnalysis(
              summaryRowFor(completed.id, game, {
                classificationCounts: { best: 4, good: 2, inaccuracy: 1, mistake: 1, blunder: 1 },
                userMoves: 6,
                totalMoves: 12,
                accuracy: 82.3,
                accuracyMoves: 6,
              }),
            );
          }
        }
        return gameIds.length;
      },
    };
  }

  it('backfills a summary for an older analyzed game so its insights appear', async () => {
    const game = fixtureGame('cc-blitz-clean');
    await gamesRepository.saveGame(game);
    // A completed run whose summary row predates the summary table (absent).
    await seedJob(game.id, 'completed');
    const service = serviceWithBackfill();

    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    // The backfill derives + persists an `absent` summary and the row reloads.
    await waitFor(() => expect(screen.getByTestId(`row-insights-${game.id}`)).toBeInTheDocument());
    expect(service.backfillCalls.length).toBeGreaterThan(0);
    expect(service.backfillCalls.flat()).toContain(game.id);
    expect(
      within(screen.getByTestId(`row-insights-${game.id}`)).getByTestId('row-insights-accuracy'),
    ).toHaveTextContent('Accuracy 82.3%');
  });

  it('does not call backfill when every completed row already has insights', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 4, good: 2, inaccuracy: 1, mistake: 1, blunder: 1 },
      accuracy: 80,
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: DETECTION_VERSION,
    });
    const service = serviceWithBackfill();

    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });

    await waitFor(() => expect(screen.getByTestId(`row-insights-${game.id}`)).toBeInTheDocument());
    expect(service.backfillCalls).toEqual([]);
  });
});

describe('GameLibrary bulk Analyze routing (selected games always queue)', () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.analysisSummaries.clear();
    await db.puzzleCandidates.clear();
    await db.positionAnalysisCache.clear();
  });

  it('re-analyzes an already-analyzed selection instead of silently dropping it', async () => {
    const game = fixtureGame('cc-bullet-blunder');
    await gamesRepository.saveGame(game);
    const { service, engine } = createFakeAnalysisService();
    await service.analyzeGames([game.id]);

    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
        'data-status',
        'completed',
      ),
    );

    const before = engine.requests.length;
    expect(before).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId(`game-select-${game.id}`));
    fireEvent.click(screen.getByTestId('library-analyze'));

    // A completed run under the current settings is force re-analyzed: the
    // selection must not be silently skipped (the engine is used again).
    await waitFor(() => expect(engine.requests.length).toBeGreaterThan(before), {
      timeout: 10_000,
    });
    await waitFor(
      () =>
        expect(screen.getByTestId(`game-analysis-${game.id}`)).toHaveAttribute(
          'data-status',
          'completed',
        ),
      { timeout: 10_000 },
    );
  });

  it('analyzes a mixed selection (unanalyzed + already-analyzed) end to end', async () => {
    const analyzed = fixtureGame('cc-bullet-blunder');
    const unanalyzed = fixtureGame('li-blitz-blunder');
    await gamesRepository.saveGame(analyzed);
    await gamesRepository.saveGame(unanalyzed);
    const { service, engine } = createFakeAnalysisService();
    await service.analyzeGames([analyzed.id]);

    renderWithProviders(<GameLibrary refreshKey={0} analysisService={service} />, {
      initialEntries: ['/games'],
    });
    await waitFor(() => expect(screen.getAllByTestId(/^game-analysis-/)).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByTestId(`game-analysis-${analyzed.id}`)).toHaveAttribute(
        'data-status',
        'completed',
      ),
    );

    const before = engine.requests.length;

    fireEvent.click(screen.getByTestId(`game-select-${analyzed.id}`));
    fireEvent.click(screen.getByTestId(`game-select-${unanalyzed.id}`));
    fireEvent.click(screen.getByTestId('library-analyze'));

    await waitFor(() => expect(engine.requests.length).toBeGreaterThan(before), {
      timeout: 10_000,
    });
    for (const id of [analyzed.id, unanalyzed.id]) {
      await waitFor(
        () =>
          expect(screen.getByTestId(`game-analysis-${id}`)).toHaveAttribute(
            'data-status',
            'completed',
          ),
        { timeout: 10_000 },
      );
    }
  });
});
