import { describe, expect, it } from 'vitest';
import { DETECTION_VERSION } from '@/domain/tactics/types';
import {
  buildStatisticsDiagnostics,
  detectionIsCurrent,
  eligibleAnalysisOf,
  groupJobsByGame,
  groupSummariesByAnalysisId,
} from '../eligibility';
import { buildGameHistoryEntries } from '../history';
import { attempt, game, job, summary } from './builders';
import { detectionStatesScenario, missingDataScenario } from './scenarios';
import type { StatisticsAnalysisSummary } from '../types';

describe('eligibleAnalysisOf', () => {
  it('selects the latest completed job by updatedAt and its summary', () => {
    const jobs = [
      job({ id: 'a1', gameId: 'g1', updatedAt: 1_000 }),
      job({ id: 'a2', gameId: 'g1', updatedAt: 2_000 }),
    ];
    const summaries = [
      summary({ analysisId: 'a1', gameId: 'g1' }),
      summary({ analysisId: 'a2', gameId: 'g1' }),
    ];
    const eligible = eligibleAnalysisOf('g1', jobs, groupSummariesByAnalysisId(summaries));
    expect(eligible?.analysisId).toBe('a2');
  });

  it('ignores non-completed jobs and returns undefined without a summary', () => {
    const jobs = [
      job({ id: 'a1', gameId: 'g1', state: 'failed' }),
      job({ id: 'a2', gameId: 'g1', state: 'queued' }),
    ];
    expect(eligibleAnalysisOf('g1', jobs, new Map())).toBeUndefined();
    const completed = [job({ id: 'a3', gameId: 'g1' })];
    expect(eligibleAnalysisOf('g1', completed, new Map())).toBeUndefined();
  });
});

describe('detectionIsCurrent', () => {
  it('requires a completed pass at the current DETECTION_VERSION', () => {
    expect(
      detectionIsCurrent(
        summary({ detectionState: 'completed', detectionVersion: DETECTION_VERSION }),
      ),
    ).toBe(true);
    expect(
      detectionIsCurrent(
        summary({ detectionState: 'completed', detectionVersion: DETECTION_VERSION - 1 }),
      ),
    ).toBe(false);
    expect(detectionIsCurrent(summary({ detectionState: 'failed', detectionVersion: null }))).toBe(
      false,
    );
  });

  it('keeps an older completed pass and non-completed states as absent (null)', () => {
    const { games, jobs, summaries } = detectionStatesScenario();
    const entries = buildGameHistoryEntries(
      games,
      groupJobsByGame(jobs),
      groupSummariesByAnalysisId(summaries),
    );
    const byId = new Map(entries.map((entry) => [entry.gameId, entry]));
    expect(byId.get('g-current')?.missedTactics).toBe(0);
    expect(byId.get('g-older')?.missedTactics).toBeNull();
    expect(byId.get('g-queued')?.missedTactics).toBeNull();
    expect(byId.get('g-absent')?.missedTactics).toBeNull();
  });
});

describe('buildGameHistoryEntries', () => {
  it('excludes a game whose completed analysis has no summary', () => {
    const gameRow = game({ id: 'g1' });
    const jobs = [job({ id: 'a1', gameId: 'g1' })];
    const entries = buildGameHistoryEntries(
      [gameRow],
      groupJobsByGame(jobs),
      groupSummariesByAnalysisId([]),
    );
    expect(entries[0]?.analysisId).toBeNull();
    expect(entries[0]?.analysisStatus).toBe('completed');
    expect(entries[0]?.classificationCounts).toBeNull();
  });

  it('keeps the previous completed analysis during a pending re-analysis', () => {
    const gameRow = game({ id: 'g1' });
    const jobs = [
      job({ id: 'a1', gameId: 'g1', state: 'completed', updatedAt: 1_000 }),
      job({ id: 'a2', gameId: 'g1', state: 'queued', updatedAt: 2_000 }),
    ];
    const summaries = [summary({ analysisId: 'a1', gameId: 'g1' })];
    const entries = buildGameHistoryEntries(
      [gameRow],
      groupJobsByGame(jobs),
      groupSummariesByAnalysisId(summaries),
    );
    expect(entries[0]?.analysisId).toBe('a1');
    expect(entries[0]?.analysisStatus).toBe('queued');
    expect(entries[0]?.accuracy).toBe(90);
  });
});

describe('buildStatisticsDiagnostics', () => {
  it('counts missing summary, pending analysis, undated and unrecognized time controls', () => {
    const gameRow = game({ id: 'g1' });
    const jobs = [
      job({ id: 'a1', gameId: 'g1', state: 'completed', updatedAt: 1_000 }),
      job({ id: 'a2', gameId: 'g1', state: 'inProgress', updatedAt: 2_000 }),
    ];
    const diagnostics = buildStatisticsDiagnostics({
      games: [gameRow],
      jobsByGame: groupJobsByGame(jobs),
      summaries: [],
    });
    expect(diagnostics.missingSummary).toBe(1);
    expect(diagnostics.pendingAnalysis).toBe(1);
    expect(diagnostics.undated).toBe(0);
  });

  it('counts undated and runtime-unrecognized time controls', () => {
    const scenario = missingDataScenario();
    const diagnostics = buildStatisticsDiagnostics({
      games: scenario.games,
      jobsByGame: groupJobsByGame(scenario.jobs),
      summaries: scenario.summaries,
    });
    expect(diagnostics.undated).toBe(1);
    expect(diagnostics.unrecognizedTimeControls).toBe(1);
  });

  it('counts orphaned summaries and attempts without fabricating values', () => {
    const gameRow = game({ id: 'g1' });
    const orphan: StatisticsAnalysisSummary = summary({ analysisId: 'a-ghost', gameId: 'g-ghost' });
    const diagnostics = buildStatisticsDiagnostics({
      games: [gameRow],
      jobsByGame: new Map(),
      summaries: [orphan],
      attempts: [attempt({ puzzleId: 'known' }), attempt({ puzzleId: 'missing' })],
      knownPuzzleIds: new Set(['known']),
    });
    expect(diagnostics.orphanedSummaries).toBe(1);
    expect(diagnostics.orphanedAttempts).toBe(1);
  });
});
