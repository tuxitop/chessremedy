import { describe, expect, it } from 'vitest';
import { DETECTION_VERSION } from '@/domain/tactics';
import { phaseMetricsFor, summarizeByPhase } from '../phase';
import { moveAnalysis } from './builders';

const CURRENT = new Set(['a-current']);

function records() {
  return [
    moveAnalysis({
      analysisId: 'a-current',
      gameId: 'gA',
      gamePhase: 'opening',
      classification: 'inaccuracy',
      missedTactic: true,
    }),
    moveAnalysis({
      analysisId: 'a-current',
      gameId: 'gA',
      gamePhase: 'opening',
      classification: 'best',
    }),
    moveAnalysis({
      analysisId: 'a-current',
      gameId: 'gA',
      gamePhase: 'middlegame',
      classification: 'blunder',
    }),
    moveAnalysis({
      analysisId: 'a-old',
      gameId: 'gB',
      gamePhase: 'opening',
      classification: 'mistake',
    }),
    moveAnalysis({
      analysisId: 'a-old',
      gameId: 'gB',
      gamePhase: 'middlegame',
      classification: 'blunder',
    }),
    moveAnalysis({
      analysisId: 'a-old',
      gameId: 'gB',
      gamePhase: 'middlegame',
      classification: 'mistake',
    }),
    moveAnalysis({
      analysisId: 'a-old',
      gameId: 'gB',
      gamePhase: 'middlegame',
      classification: 'best',
    }),
    moveAnalysis({
      analysisId: 'a-current',
      gameId: 'gA',
      side: 'black',
      gamePhase: 'opening',
      classification: 'blunder',
    }),
    moveAnalysis({
      analysisId: 'a-current',
      gameId: 'gA',
      gamePhase: undefined as unknown as 'opening',
      classification: 'blunder',
    }),
  ];
}

function metrics() {
  return phaseMetricsFor(summarizeByPhase(records(), 'white', CURRENT, DETECTION_VERSION));
}

describe('summarizeByPhase', () => {
  it('groups by stored phase with per-phase denominators and current detection', () => {
    const summary = summarizeByPhase(records(), 'white', CURRENT, DETECTION_VERSION);
    expect(summary.analyzedGames).toBe(2);
    expect(summary.detectedGames).toBe(1);
    const opening = summary.phases.find((phase) => phase.phase === 'opening');
    const middlegame = summary.phases.find((phase) => phase.phase === 'middlegame');
    const endgame = summary.phases.find((phase) => phase.phase === 'endgame');
    expect(opening).toEqual({
      phase: 'opening',
      userMovesInPhase: 3,
      detectedUserMovesInPhase: 2,
      inaccuracies: 1,
      mistakes: 1,
      blunders: 0,
      missedTactics: 1,
    });
    expect(middlegame).toEqual({
      phase: 'middlegame',
      userMovesInPhase: 4,
      detectedUserMovesInPhase: 1,
      inaccuracies: 0,
      mistakes: 1,
      blunders: 2,
      missedTactics: 0,
    });
    expect(endgame?.userMovesInPhase).toBe(0);
  });

  it('never fabricates a phase from a missing/undefined gamePhase', () => {
    const summary = summarizeByPhase(records(), 'white', CURRENT, DETECTION_VERSION);
    const totalUserMoves = summary.phases.reduce((sum, phase) => sum + phase.userMovesInPhase, 0);
    expect(totalUserMoves).toBe(7);
    expect(summary.phases.map((phase) => phase.phase)).toEqual([
      'opening',
      'middlegame',
      'endgame',
    ]);
  });

  it('ignores opponent moves', () => {
    const summary = summarizeByPhase(records(), 'black', CURRENT, DETECTION_VERSION);
    const opening = summary.phases.find((phase) => phase.phase === 'opening');
    expect(opening?.blunders).toBe(1);
    expect(opening?.userMovesInPhase).toBe(1);
    expect(summary.analyzedGames).toBe(1);
  });
});

describe('phaseMetricsFor', () => {
  it('uses the analyzed-game denominator for counts and the phase-move denominator for rates', () => {
    const opening = metrics().find((phase) => phase.phase === 'opening');
    expect(opening?.counts.inaccuracies).toEqual({
      value: 1,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(opening?.counts.blunders).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(opening?.errorsPer100Moves.inaccuracies).toEqual({
      value: 100 / 3,
      state: 'insufficient',
      sample: { unit: 'moves', n: 3 },
    });
    expect(opening?.errorsPer100Moves.blunders).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'moves', n: 3 },
    });
    expect(opening?.counts.missedTactics).toEqual({
      value: 1,
      state: 'insufficient',
      sample: { unit: 'games', n: 1 },
    });
    expect(opening?.errorsPer100Moves.missedTactics).toEqual({
      value: 50,
      state: 'insufficient',
      sample: { unit: 'moves', n: 2 },
    });
  });

  it('keeps phases with differing move exposure non-comparable by count', () => {
    const middlegame = metrics().find((phase) => phase.phase === 'middlegame');
    expect(middlegame?.errorsPer100Moves.blunders.value).toBe(50);
    expect(middlegame?.errorsPer100Moves.mistakes.value).toBe(25);
  });

  it('reports empty (not zero) for a phase with no user moves', () => {
    const endgame = metrics().find((phase) => phase.phase === 'endgame');
    expect(endgame?.userMovesInPhase).toBe(0);
    expect(endgame?.counts.inaccuracies).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'games', n: 2 },
    });
    expect(endgame?.errorsPer100Moves.inaccuracies).toEqual({
      value: null,
      state: 'empty',
      sample: { unit: 'moves', n: 0 },
    });
  });

  it('reports notDetected for missed tactics when no analysis has a current pass', () => {
    const opening = phaseMetricsFor(
      summarizeByPhase(records(), 'white', new Set(), DETECTION_VERSION),
    ).find((phase) => phase.phase === 'opening');
    expect(opening?.counts.missedTactics).toEqual({
      value: null,
      state: 'notDetected',
      sample: { unit: 'games', n: 0 },
    });
    expect(opening?.errorsPer100Moves.missedTactics).toEqual({
      value: null,
      state: 'notDetected',
      sample: { unit: 'moves', n: 0 },
    });
  });
});

describe('summarizeByPhase (missed-tactic exclusivity, ADR-023 amendment)', () => {
  function exclusiveRecords(detectionVersion: number) {
    return [
      moveAnalysis({
        analysisId: 'a-current',
        gameId: 'gA',
        gamePhase: 'opening',
        classification: 'blunder',
        missedTactic: true,
        detectionVersion,
      }),
      moveAnalysis({
        analysisId: 'a-current',
        gameId: 'gA',
        gamePhase: 'opening',
        classification: 'best',
      }),
    ];
  }

  it('excludes a current-version verified miss from the error numerators but keeps the denominators', () => {
    const summary = summarizeByPhase(
      exclusiveRecords(DETECTION_VERSION),
      'white',
      CURRENT,
      DETECTION_VERSION,
    );
    const opening = summary.phases.find((phase) => phase.phase === 'opening');
    expect(opening).toEqual({
      phase: 'opening',
      userMovesInPhase: 2,
      detectedUserMovesInPhase: 2,
      inaccuracies: 0,
      mistakes: 0,
      blunders: 0,
      missedTactics: 1,
    });

    const metrics = phaseMetricsFor(summary).find((phase) => phase.phase === 'opening');
    expect(metrics?.counts.blunders).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'games', n: 1 },
    });
    expect(metrics?.errorsPer100Moves.blunders).toEqual({
      value: 0,
      state: 'insufficient',
      sample: { unit: 'moves', n: 2 },
    });
  });

  it('counts a stale marker as its raw classification', () => {
    const opening = summarizeByPhase(
      exclusiveRecords(DETECTION_VERSION - 1),
      'white',
      CURRENT,
      DETECTION_VERSION,
    ).phases.find((phase) => phase.phase === 'opening');
    expect(opening?.blunders).toBe(1);
    expect(opening?.missedTactics).toBe(1);
  });
});
