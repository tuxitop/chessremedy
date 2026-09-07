import { describe, expect, it } from 'vitest';
import { markCompleted, markInProgress } from '@/domain/analysis';
import { makeEngine, makeJob } from '@/domain/analysis/test-support';
import { DEFAULT_LIBRARY_FILTERS } from '@/domain/gameLibrary/filters';
import type { AnalysisSummaryRow } from './summaries-repository';
import {
  analysisInsightsForGame,
  resolveAnalysisResultFilter,
  resolveGameAnalysis,
} from './analysis-result-query';

/** Full filters over the three analysis-result dimensions (base = all/all/all). */
function analysisFilters(patch: {
  readonly analysis?: 'analyzed' | 'notAnalyzed';
  readonly hasBlunders?: 'yes' | 'no';
  readonly hasMissedTactics?: 'yes' | 'no';
}): typeof DEFAULT_LIBRARY_FILTERS {
  return { ...DEFAULT_LIBRARY_FILTERS, ...patch };
}

function summaryFor(
  analysisId: string,
  gameId: string,
  overrides: Partial<AnalysisSummaryRow> = {},
): AnalysisSummaryRow {
  return {
    analysisId,
    gameId,
    userColor: 'white',
    classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    userMoves: 10,
    totalMoves: 20,
    accuracy: 80,
    accuracyMoves: 10,
    detectionState: 'absent',
    missedTacticCount: null,
    detectionVersion: null,
    updatedAt: 5,
    ...overrides,
  };
}

function completedJob(gameId: string, nowMs = 10) {
  return markCompleted(makeJob(gameId, 2), nowMs);
}

const G_UN = 'lichess:unanalyzed';
const G_QUEUED = 'lichess:queued';
const G_CLEAN = 'lichess:clean';
const G_BLUNDER = 'lichess:blunder';
const G_MISSED = 'lichess:missed';
const G_DETECTION_ABSENT = 'lichess:detection-absent';
const G_NO_SUMMARY = 'lichess:no-summary';
const UNIVERSE = [G_UN, G_QUEUED, G_CLEAN, G_BLUNDER, G_MISSED, G_DETECTION_ABSENT, G_NO_SUMMARY];

function fixtureJobsAndSummaries(): {
  jobs: ReturnType<typeof completedJob>[];
  summaries: AnalysisSummaryRow[];
} {
  const cleanJob = completedJob(G_CLEAN, 10);
  const blunderJob = completedJob(G_BLUNDER, 10);
  const missedJob = completedJob(G_MISSED, 10);
  const absentJob = completedJob(G_DETECTION_ABSENT, 10);
  const noSummaryJob = completedJob(G_NO_SUMMARY, 10);
  const queuedJob = markInProgress(makeJob(G_QUEUED, 2), 10);
  return {
    jobs: [cleanJob, blunderJob, missedJob, absentJob, noSummaryJob, queuedJob],
    summaries: [
      summaryFor(cleanJob.id, G_CLEAN, {
        classificationCounts: { best: 8, good: 1, inaccuracy: 1, mistake: 0, blunder: 0 },
        detectionState: 'completed',
        missedTacticCount: 0,
        detectionVersion: 1,
      }),
      summaryFor(blunderJob.id, G_BLUNDER, {
        classificationCounts: { best: 5, good: 2, inaccuracy: 1, mistake: 0, blunder: 2 },
      }),
      summaryFor(missedJob.id, G_MISSED, {
        classificationCounts: { best: 6, good: 0, inaccuracy: 1, mistake: 0, blunder: 3 },
        detectionState: 'completed',
        missedTacticCount: 1,
        detectionVersion: 1,
      }),
      summaryFor(absentJob.id, G_DETECTION_ABSENT, {
        classificationCounts: { best: 9, good: 1, inaccuracy: 0, mistake: 0, blunder: 0 },
        detectionState: 'queued',
        missedTacticCount: null,
      }),
      // G_NO_SUMMARY deliberately has no summary row (lazy backfill pending).
    ],
  };
}

describe('resolveGameAnalysis', () => {
  it('reports unanalyzed for a game with no jobs or summaries', () => {
    expect(resolveGameAnalysis([], [])).toEqual({ status: 'unanalyzed', summary: null });
  });

  it('hides the summary when an active run shadows a completed one', () => {
    const job = completedJob('lichess:g', 10);
    const active = markInProgress(makeJob('lichess:g', 2), 20);
    const summary = summaryFor(job.id, 'lichess:g');
    expect(resolveGameAnalysis([job, active], [summary])).toEqual({
      status: 'inProgress',
      summary: null,
    });
  });

  it('returns completed status with the matching latest summary', () => {
    const job = completedJob('lichess:g', 10);
    const summary = summaryFor(job.id, 'lichess:g');
    expect(resolveGameAnalysis([job], [summary])).toEqual({ status: 'completed', summary });
  });

  it('flags an obsolete completed run as outdated but still usable', () => {
    const stale = { ...completedJob('lichess:g', 10), analysisVersion: 0 };
    const summary = summaryFor(stale.id, 'lichess:g');
    const resolved = resolveGameAnalysis([stale], [summary]);
    expect(resolved.status).toBe('outdated');
    expect(resolved.summary).toEqual(summary);
  });

  it('exposes only the latest completed run summary', () => {
    const older = completedJob('lichess:g', 10);
    const newer = markCompleted(makeJob('lichess:g', 2, makeEngine('fast')), 20);
    const olderSummary = summaryFor(older.id, 'lichess:g', { accuracy: 60 });
    const newerSummary = summaryFor(newer.id, 'lichess:g', { accuracy: 90 });
    expect(resolveGameAnalysis([older, newer], [olderSummary, newerSummary])).toEqual({
      status: 'completed',
      summary: newerSummary,
    });
  });

  it('returns null summary when a completed run has no persisted summary', () => {
    const job = completedJob('lichess:g', 10);
    expect(resolveGameAnalysis([job], [])).toEqual({ status: 'completed', summary: null });
  });
});

describe('analysisInsightsForGame', () => {
  it('returns only the status when no completed run summary exists', () => {
    expect(analysisInsightsForGame([], [])).toEqual({ analysisStatus: 'unanalyzed' });
    const job = completedJob(G_NO_SUMMARY, 10);
    expect(analysisInsightsForGame([job], [])).toEqual({ analysisStatus: 'completed' });
    const active = markInProgress(makeJob(G_QUEUED, 2), 10);
    expect(analysisInsightsForGame([active], [])).toEqual({ analysisStatus: 'inProgress' });
  });

  it('carries accuracy and counts but absent (null) missed tactics pre-detection', () => {
    const job = completedJob(G_BLUNDER, 10);
    const insights = analysisInsightsForGame([job], [summaryFor(job.id, G_BLUNDER)]);
    expect(insights).toEqual({
      analysisStatus: 'completed',
      accuracy: 80,
      classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      detectionState: 'absent',
      hasCompletedDetection: false,
      missedTactics: null,
      scanProgress: null,
    });
  });

  it('reports the detection state verbatim while a pass is still running', () => {
    const job = completedJob(G_BLUNDER, 10);
    const insights = analysisInsightsForGame(
      [job],
      [summaryFor(job.id, G_BLUNDER, { detectionState: 'inProgress' })],
    );
    expect(insights.detectionState).toBe('inProgress');
    expect(insights.hasCompletedDetection).toBe(false);
    expect(insights.missedTactics).toBeNull();
  });

  it('surfaces a real zero only after the detection pass completed', () => {
    const job = completedJob(G_CLEAN, 10);
    const insights = analysisInsightsForGame(
      [job],
      [
        summaryFor(job.id, G_CLEAN, {
          detectionState: 'completed',
          missedTacticCount: 0,
          detectionVersion: 1,
        }),
      ],
    );
    expect(insights.hasCompletedDetection).toBe(true);
    expect(insights.missedTactics).toBe(0);
  });

  it('surfaces a positive missed-tactic count after detection', () => {
    const job = completedJob(G_MISSED, 10);
    const insights = analysisInsightsForGame(
      [job],
      [
        summaryFor(job.id, G_MISSED, {
          detectionState: 'completed',
          missedTacticCount: 1,
          detectionVersion: 1,
        }),
      ],
    );
    expect(insights.missedTactics).toBe(1);
  });

  it('surfaces the live scan progress while a pass is running (plan 013 W3)', () => {
    const job = completedJob(G_BLUNDER, 10);
    const insights = analysisInsightsForGame(
      [job],
      [
        summaryFor(job.id, G_BLUNDER, {
          detectionState: 'inProgress',
          scanProgress: { done: 2, total: 4 },
        }),
      ],
    );
    expect(insights.detectionState).toBe('inProgress');
    expect(insights.scanProgress).toEqual({ done: 2, total: 4 });
    expect(insights.missedTactics).toBeNull();
  });
});

describe('resolveAnalysisResultFilter', () => {
  const { jobs, summaries } = fixtureJobsAndSummaries();

  it('returns null when every analysis-result dimension is all', () => {
    expect(
      resolveAnalysisResultFilter(DEFAULT_LIBRARY_FILTERS, UNIVERSE, jobs, summaries),
    ).toBeNull();
  });

  it('analyzed matches completed/outdated runs only', () => {
    const filters = analysisFilters({ analysis: 'analyzed' });
    expect(resolveAnalysisResultFilter(filters, UNIVERSE, jobs, summaries)).toEqual(
      new Set([G_CLEAN, G_BLUNDER, G_MISSED, G_DETECTION_ABSENT, G_NO_SUMMARY]),
    );
  });

  it('notAnalyzed matches every other status including jobless games', () => {
    const filters = analysisFilters({ analysis: 'notAnalyzed' });
    expect(resolveAnalysisResultFilter(filters, UNIVERSE, jobs, summaries)).toEqual(
      new Set([G_UN, G_QUEUED]),
    );
  });

  it('hasBlunders yes/no follow the latest completed summary only', () => {
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ hasBlunders: 'yes' }),
        UNIVERSE,
        jobs,
        summaries,
      ),
    ).toEqual(new Set([G_BLUNDER, G_MISSED]));
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ hasBlunders: 'no' }),
        UNIVERSE,
        jobs,
        summaries,
      ),
    ).toEqual(new Set([G_CLEAN, G_DETECTION_ABSENT]));
    // A completed run without a summary matches neither outcome.
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ hasBlunders: 'no' }),
        [G_NO_SUMMARY],
        jobs,
        summaries,
      ),
    ).toEqual(new Set());
  });

  it('hasMissedTactics matches only completed detection passes (absent ≠ zero)', () => {
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ hasMissedTactics: 'yes' }),
        UNIVERSE,
        jobs,
        summaries,
      ),
    ).toEqual(new Set([G_MISSED]));
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ hasMissedTactics: 'no' }),
        UNIVERSE,
        jobs,
        summaries,
      ),
    ).toEqual(new Set([G_CLEAN]));
    // Queued/absent detection never matches no, even with zero blunders.
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ hasMissedTactics: 'no' }),
        [G_DETECTION_ABSENT],
        jobs,
        summaries,
      ),
    ).toEqual(new Set());
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ hasMissedTactics: 'no' }),
        [G_UN],
        jobs,
        summaries,
      ),
    ).toEqual(new Set());
  });

  it('ANDs across the analysis-result dimensions', () => {
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ analysis: 'analyzed', hasBlunders: 'no' }),
        UNIVERSE,
        jobs,
        summaries,
      ),
    ).toEqual(new Set([G_CLEAN, G_DETECTION_ABSENT]));
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ analysis: 'analyzed', hasMissedTactics: 'yes' }),
        UNIVERSE,
        jobs,
        summaries,
      ),
    ).toEqual(new Set([G_MISSED]));
    expect(
      resolveAnalysisResultFilter(
        analysisFilters({ analysis: 'notAnalyzed', hasMissedTactics: 'no' }),
        UNIVERSE,
        jobs,
        summaries,
      ),
    ).toEqual(new Set());
  });
});
