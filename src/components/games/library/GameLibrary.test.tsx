import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
      detectionVersion: 1,
    });
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-accuracy')).toHaveTextContent('Accuracy 78%');
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
      'Accuracy 78 per cent, 2 blunders, 3 mistakes, 4 inaccuracies, 1 missed tactic',
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
        detectionVersion: 1,
      }),
    );
    renderLibrary();

    const strip = await screen.findByTestId(`row-insights-${game.id}`);
    expect(within(strip).getByTestId('row-insights-accuracy')).toHaveTextContent('Accuracy 61%');
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
        detectionVersion: 1,
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
      detectionVersion: 1,
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

  it('omits the Accuracy item when the completed analysis has no usable accuracy', async () => {
    const game = await seedAnalyzedGame('cc-bullet-blunder', {
      classificationCounts: { best: 3, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
      accuracy: null,
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: 1,
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
      detectionVersion: 1,
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
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(1));
    expect(screen.getByTestId(`game-select-${bare.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`game-select-${analyzed.id}`)).not.toBeInTheDocument();
  });
});

function optionLabels(select: Element): readonly string[] {
  return [...select.querySelectorAll('option')].map((option) => option.textContent?.trim() ?? '');
}
