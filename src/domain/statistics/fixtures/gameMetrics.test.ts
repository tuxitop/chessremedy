import { describe, expect, it } from 'vitest';
import { buildGameHistoryEntries } from '../history';
import { gameMetricsFor } from '../gameMetrics';
import { analyzedGame, scenarioOf, type AnalyzedGame, type StatisticsScenario } from './builders';
import {
  detectionStatesScenario,
  emptyScenario,
  indexScenario,
  noAnalysisScenario,
} from './scenarios';

function entriesFor(scenario: StatisticsScenario) {
  const { jobsByGame, summariesByAnalysisId } = indexScenario(scenario);
  return buildGameHistoryEntries(scenario.games, jobsByGame, summariesByAnalysisId);
}

function analyzedWithBlunder(blunder: number, mistake = 0, inaccuracy = 0): AnalyzedGame {
  return analyzedGame(`g-blunder-${blunder}-${mistake}-${inaccuracy}`, {
    summary: {
      classificationCounts: { best: 0, good: 0, inaccuracy, mistake, blunder },
      accuracy: null,
      accuracyMoves: 0,
      missedTacticCount: 0,
    },
  });
}

describe('gameMetricsFor — totals, averages, medians and shares', () => {
  it('matches hand-computed classification values', () => {
    const analyzed: AnalyzedGame[] = [
      analyzedWithBlunder(1, 2, 3),
      analyzedWithBlunder(0, 1, 2),
      analyzedWithBlunder(2, 0, 1),
      analyzedWithBlunder(1, 3, 0),
      analyzedWithBlunder(0, 1, 4),
    ];
    const metrics = gameMetricsFor(entriesFor(scenarioOf(analyzed)));

    expect(metrics.games).toEqual({
      total: 5,
      analyzed: 5,
      detected: 5,
      missingSummary: 0,
      pendingAnalysis: 0,
      undated: 0,
    });
    expect(metrics.classification.inaccuracies).toEqual({
      value: 10,
      state: 'ok',
      sample: { unit: 'games', n: 5 },
    });
    expect(metrics.classification.mistakes).toEqual({
      value: 7,
      state: 'ok',
      sample: { unit: 'games', n: 5 },
    });
    expect(metrics.classification.blunders).toEqual({
      value: 4,
      state: 'ok',
      sample: { unit: 'games', n: 5 },
    });
    expect(metrics.classification.inaccuraciesPerGame.value).toBe(2);
    expect(metrics.classification.mistakesPerGame.value).toBe(7 / 5);
    expect(metrics.classification.blundersPerGame.value).toBe(4 / 5);
    expect(metrics.classification.medianBlundersPerGame).toEqual({
      value: 1,
      state: 'ok',
      sample: { unit: 'games', n: 5 },
    });
    expect(metrics.classification.medianMistakesPerGame).toEqual({
      value: 1,
      state: 'ok',
      sample: { unit: 'games', n: 5 },
    });
    expect(metrics.classification.gamesWithBlunderShare.value).toBe(3 / 5);
    expect(metrics.classification.gamesWithMistakeShare.value).toBe(4 / 5);
  });

  it('averages the two middle values for an even median sample', () => {
    const analyzed = [
      analyzedWithBlunder(1),
      analyzedWithBlunder(2),
      analyzedWithBlunder(3),
      analyzedWithBlunder(4),
    ];
    const metrics = gameMetricsFor(entriesFor(scenarioOf(analyzed)));
    expect(metrics.classification.medianBlundersPerGame).toEqual({
      value: 2.5,
      state: 'insufficient',
      sample: { unit: 'games', n: 4 },
    });
  });
});

describe('gameMetricsFor — move-weighted accuracy', () => {
  it('weights each game accuracy by its accuracy moves and exposes weightMoves', () => {
    const analyzed = [
      analyzedGame('g1', { summary: { accuracy: 90, accuracyMoves: 10 } }),
      analyzedGame('g2', { summary: { accuracy: 80, accuracyMoves: 30 } }),
      analyzedGame('g3', { summary: { accuracy: null, accuracyMoves: 0 } }),
    ];
    const metrics = gameMetricsFor(entriesFor(scenarioOf(analyzed)));
    expect(metrics.accuracy).toEqual({
      value: (90 * 10 + 80 * 30) / 40,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
      weightMoves: 40,
    });
  });

  it('is empty with zero weight when no game has an accuracy', () => {
    const analyzed = [analyzedGame('g1', { summary: { accuracy: null, accuracyMoves: 0 } })];
    const metrics = gameMetricsFor(entriesFor(scenarioOf(analyzed)));
    expect(metrics.accuracy).toEqual({
      value: null,
      state: 'empty',
      sample: { unit: 'games', n: 0 },
      weightMoves: 0,
    });
  });
});

describe('gameMetricsFor — state boundaries and absent-vs-zero', () => {
  it('reports empty (null) for zero analyzed games', () => {
    const metrics = gameMetricsFor(entriesFor(emptyScenario()));
    expect(metrics.games.total).toBe(0);
    expect(metrics.classification.blunders).toEqual({
      value: null,
      state: 'empty',
      sample: { unit: 'games', n: 0 },
    });
    expect(metrics.accuracy).toEqual({
      value: null,
      state: 'empty',
      sample: { unit: 'games', n: 0 },
      weightMoves: 0,
    });
  });

  it.each([
    [1, 'insufficient'],
    [4, 'insufficient'],
    [5, 'ok'],
  ] as const)('flags n=%i as %s', (count, state) => {
    const analyzed = Array.from({ length: count }, (_, index) =>
      analyzedGame(`g${index}`, {
        summary: {
          classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
          accuracy: 100,
          accuracyMoves: 10,
        },
      }),
    );
    const metrics = gameMetricsFor(entriesFor(scenarioOf(analyzed)));
    expect(metrics.classification.blunders.state).toBe(state);
    expect(metrics.classification.blunders.sample.n).toBe(count);
    expect(metrics.classification.blunders.value).toBe(0);
  });

  it('keeps a completed detection that found nothing as a real zero', () => {
    const metrics = gameMetricsFor(entriesFor(detectionStatesScenario()));
    expect(metrics.games.detected).toBe(1);
    expect(metrics.missedTactics.missedTactics).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'games', n: 1 },
    });
  });

  it('returns notDetected (null) when no game has a current completed pass', () => {
    const metrics = gameMetricsFor(entriesFor(noAnalysisScenario()));
    expect(metrics.games.detected).toBe(0);
    expect(metrics.missedTactics.missedTactics).toEqual({
      value: null,
      state: 'notDetected',
      sample: { unit: 'games', n: 0 },
    });
    expect(metrics.missedTactics.missedTacticsPerGame.state).toBe('notDetected');
    expect(metrics.missedTactics.gamesWithMissedTacticShare.state).toBe('notDetected');
  });
});
