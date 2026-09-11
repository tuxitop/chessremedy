import { describe, expect, it } from 'vitest';
import { buildGameHistoryEntries } from '../history';
import { gameMetricsFor } from '../gameMetrics';
import { partitionGames } from '../query';
import { buildVersionSummary } from '../version';
import type { StatisticsQuery } from '../types';
import { detectionStatesScenario, sixTimeControlsScenario } from './scenarios';
import { groupJobsByGame, groupSummariesByAnalysisId } from '../eligibility';

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const QUERY: StatisticsQuery = {
  platform: 'all',
  timeControl: 'all',
  side: 'all',
  result: 'all',
  dateRange: { preset: 'all' },
  now: NOW,
};

describe('determinism', () => {
  it('produces identical history entries for identical inputs', () => {
    const { games, jobs, summaries } = detectionStatesScenario();
    const build = () =>
      buildGameHistoryEntries(games, groupJobsByGame(jobs), groupSummariesByAnalysisId(summaries));
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('produces identical metrics for identical entries', () => {
    const { games, jobs, summaries } = detectionStatesScenario();
    const entries = buildGameHistoryEntries(
      games,
      groupJobsByGame(jobs),
      groupSummariesByAnalysisId(summaries),
    );
    expect(JSON.stringify(gameMetricsFor(entries))).toBe(JSON.stringify(gameMetricsFor(entries)));
  });

  it('produces identical partitions for identical inputs', () => {
    const { games } = sixTimeControlsScenario();
    expect(JSON.stringify(partitionGames(games, { ...QUERY, combine: true }, 'activity'))).toBe(
      JSON.stringify(partitionGames(games, { ...QUERY, combine: true }, 'activity')),
    );
  });

  it('produces identical version summaries for identical inputs', () => {
    const { jobs, summaries } = detectionStatesScenario();
    expect(JSON.stringify(buildVersionSummary(jobs, summaries))).toBe(
      JSON.stringify(buildVersionSummary(jobs, summaries)),
    );
  });
});
