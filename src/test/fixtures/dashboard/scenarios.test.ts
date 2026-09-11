/**
 * Feature 015 — dashboard scenario fixture contract (Stage 2).
 *
 * Locks the deterministic fixture matrix the hook/component tests rely on:
 * every aggregate state, concrete partitions, trend gaps and a period-boundary
 * point, per-platform rating histories, the training cycle states and a
 * mixed/outdated version summary. No engine, network or real user data.
 */

import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION } from '@/domain/chess/analysis';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import {
  emptyDashboardScenario,
  mixedVersionDashboardScenario,
  richDashboardScenario,
} from './scenarios';

const RICH_SET_ID = 'fixture:dashboard-set';

function partitionMap(data: ReturnType<typeof richDashboardScenario>['data']) {
  if (!data.gameMetrics.ok) {
    throw new Error('fixture gameMetrics must be ok');
  }
  return new Map(
    data.gameMetrics.result.partitions.map((partition) => [
      `${partition.platform}:${partition.timeControl}`,
      partition,
    ]),
  );
}

describe('richDashboardScenario game analysis', () => {
  it('covers ok, insufficient, empty and notDetected across concrete partitions', () => {
    const partitions = partitionMap(richDashboardScenario().data);

    expect([...partitions.keys()]).toEqual(['lichess:bullet', 'lichess:rapid', 'chesscom:blitz']);

    const rapid = partitions.get('lichess:rapid')!;
    expect(rapid.metrics.accuracy.state).toBe('ok');
    expect(rapid.metrics.accuracy.sample.n).toBeGreaterThanOrEqual(5);
    expect(rapid.metrics.classification.blunders.state).toBe('ok');

    const blitz = partitions.get('chesscom:blitz')!;
    expect(blitz.metrics.classification.blunders.state).toBe('insufficient');
    expect(blitz.metrics.classification.blunders.sample.n).toBe(4);
    expect(blitz.metrics.missedTactics.missedTactics.state).toBe('notDetected');

    const bullet = partitions.get('lichess:bullet')!;
    expect(bullet.metrics.accuracy.state).toBe('empty');
    expect(bullet.metrics.classification.blunders.state).toBe('empty');
  });

  it('produces an accuracy trend with explicit gaps and a period-boundary point', () => {
    const data = richDashboardScenario().data;
    if (!data.trends.accuracy.ok) {
      throw new Error('fixture accuracy trend must be ok');
    }
    const rapid = data.trends.accuracy.result.series.find(
      (series) => series.platform === 'lichess' && series.timeControl === 'rapid',
    )!;
    expect(rapid.points.map((point) => point.state)).toEqual([
      'ok',
      'empty',
      'insufficient',
      'empty',
      'insufficient',
    ]);
    // The last point is the single Monday game at the start of a new ISO week.
    expect(rapid.points[rapid.points.length - 1]?.periodKey).toMatch(/W\d{2}$/);
  });

  it('produces per-platform rating histories and excludes unrated/undated games', () => {
    const data = richDashboardScenario().data;
    if (!data.ratings.ok) {
      throw new Error('fixture ratings must be ok');
    }
    const byKey = new Map(
      data.ratings.result.histories.map((history) => [
        `${history.platform}:${history.timeControl}`,
        history,
      ]),
    );
    // 10 rated, dated rapid games; the missing-rating and undated games add none.
    expect(byKey.get('lichess:rapid')?.points).toHaveLength(10);
    expect(byKey.has('chesscom:blitz')).toBe(true);
  });

  it('produces phase metrics with differing per-phase move exposure', () => {
    const data = richDashboardScenario().data;
    if (!data.phases.ok) {
      throw new Error('fixture phases must be ok');
    }
    const rapid = data.phases.result.partitions.find(
      (partition) => partition.platform === 'lichess' && partition.timeControl === 'rapid',
    )!;
    const byPhase = new Map(rapid.phases.map((phase) => [phase.phase, phase]));
    expect(byPhase.get('opening')?.errorsPer100Moves.inaccuracies.state).toBe('ok');
    expect(byPhase.get('middlegame')?.errorsPer100Moves.inaccuracies.state).toBe('insufficient');
    expect(byPhase.get('endgame')?.errorsPer100Moves.inaccuracies.state).toBe('insufficient');
  });
});

describe('richDashboardScenario training', () => {
  it('covers completed, abandoned and inProgress cycles with ranked/unranked categories', () => {
    const entry = richDashboardScenario().data.training[RICH_SET_ID]!;
    expect(entry.stats.cycles.map((cycle) => cycle.status)).toEqual([
      'completed',
      'completed',
      'abandoned',
      'completed',
      'inProgress',
    ]);
    expect(entry.stats.abandonedCycles).toHaveLength(1);
    expect(entry.stats.inProgressCycles).toHaveLength(1);
    expect(entry.categories.some((category) => category.ranked)).toBe(true);
    expect(entry.categories.some((category) => !category.ranked)).toBe(true);
    expect(entry.failed.length).toBeGreaterThan(0);
  });
});

describe('mixedVersionDashboardScenario provenance', () => {
  it('reports mixed engine/classification versions and an outdated pipeline', () => {
    const data = mixedVersionDashboardScenario().data;
    if (!data.gameMetrics.ok) {
      throw new Error('fixture gameMetrics must be ok');
    }
    const versions = data.gameMetrics.result.versions;
    expect(versions.mixedEngineVersions).toBe(true);
    expect(versions.mixedClassificationVersions).toBe(true);
    expect(versions.analysisVersion).toContain(ANALYSIS_VERSION);
    expect(versions.analysisVersion).toContain(ANALYSIS_VERSION - 1);
    expect(versions.classificationVersion).toContain(CLASSIFICATION_VERSION - 1);
  });
});

describe('emptyDashboardScenario', () => {
  it('has no partitions and no training sets', () => {
    const data = emptyDashboardScenario().data;
    if (!data.gameMetrics.ok) {
      throw new Error('fixture gameMetrics must be ok');
    }
    expect(data.gameMetrics.result.partitions).toEqual([]);
    expect(Object.keys(data.training)).toEqual([]);
  });
});
