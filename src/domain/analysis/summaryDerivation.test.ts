import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '@/domain/chess';
import { makeMove } from './test-support';
import { summarizeAnalysis } from './summary';
import { gameAccuracy } from './accuracy';
import { buildAnalysisSummary } from './summaryDerivation';
import { blunderGameRecords, ordinaryGameRecords } from './fixtures/classificationScenarios';

const GAME = 'lichess:sderiv';
const ANALYSIS = 'a-sderiv';

function freezeRecords(records: readonly MoveAnalysis[]): readonly MoveAnalysis[] {
  Object.freeze(records);
  for (const record of records) {
    Object.freeze(record);
  }
  return records;
}

/**
 * Two verified user missed tactics (plies 0 and 2), one opponent missed
 * tactic (ply 1) that must never be counted for a White user, and a clean
 * opponent ply.
 */
function missedTacticRecords(): readonly MoveAnalysis[] {
  const missed = (
    ply: number,
    side: 'white' | 'black',
    classification: MoveAnalysis['classification'],
  ) =>
    makeMove(ply, {
      gameId: GAME,
      analysisId: ANALYSIS,
      side,
      classification,
      missedTactic: true,
      detectionVersion: 1,
    });
  return [
    missed(0, 'white', 'blunder'),
    missed(1, 'black', 'mistake'),
    missed(2, 'white', 'mistake'),
    makeMove(3, { gameId: GAME, analysisId: ANALYSIS, side: 'black', classification: 'best' }),
  ];
}

describe('buildAnalysisSummary (counts + accuracy over canonical fixtures)', () => {
  it('matches summarizeAnalysis and gameAccuracy on the ordinary fixture', () => {
    const records = ordinaryGameRecords(GAME, ANALYSIS);
    const built = buildAnalysisSummary(records, 'white');
    const summary = summarizeAnalysis(records, 'white');
    const accuracy = gameAccuracy(records, 'white');

    expect(built.classificationCounts).toEqual(summary.user);
    expect(built.userMoves).toBe(summary.userMoves);
    expect(built.totalMoves).toBe(summary.totalMoves);
    expect(built.accuracy).toBe(accuracy.accuracy);
    expect(built.accuracyMoves).toBe(accuracy.moves);
  });

  it('reports the known user counts and accuracy of the ordinary fixture', () => {
    const built = buildAnalysisSummary(ordinaryGameRecords(GAME, ANALYSIS), 'white');
    expect(built.classificationCounts).toEqual({
      best: 1,
      good: 4,
      inaccuracy: 1,
      mistake: 0,
      blunder: 0,
    });
    expect(built.userMoves).toBe(6);
    expect(built.totalMoves).toBe(12);
    expect(built.accuracyMoves).toBe(6);
    expect(built.accuracy).toBeCloseTo(94.675, 2);
  });

  it('reports the blunder-review fixture counts and accuracy (user White)', () => {
    const built = buildAnalysisSummary(blunderGameRecords(GAME, ANALYSIS), 'white');
    expect(built.classificationCounts).toEqual({
      best: 0,
      good: 1,
      inaccuracy: 0,
      mistake: 0,
      blunder: 1,
    });
    expect(built.userMoves).toBe(2);
    expect(built.accuracyMoves).toBe(2);
    expect(built.accuracy).toBeCloseTo(52.239, 3);
  });

  it('counts only the white-user side', () => {
    const built = buildAnalysisSummary(blunderGameRecords(GAME, ANALYSIS), 'black');
    expect(built.classificationCounts).toEqual({
      best: 1,
      good: 1,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
    });
    expect(built.userMoves).toBe(2);
  });
});

describe('buildAnalysisSummary (accuracy null handling)', () => {
  it('returns null accuracy with a 0 sample on empty records', () => {
    const built = buildAnalysisSummary([], 'white');
    expect(built.accuracy).toBeNull();
    expect(built.accuracyMoves).toBe(0);
    expect(built.classificationCounts).toEqual({
      best: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
    });
    expect(built.userMoves).toBe(0);
  });

  it('returns null accuracy when the user has no moves in the records', () => {
    const opponentOnly = ordinaryGameRecords(GAME, ANALYSIS).filter((r) => r.side === 'black');
    const built = buildAnalysisSummary(opponentOnly, 'white');
    expect(built.accuracy).toBeNull();
    expect(built.accuracyMoves).toBe(0);
  });

  it('counts classifications but returns null accuracy when no eval pair is usable', () => {
    const noEvalRecords = [
      makeMove(0, {
        gameId: GAME,
        analysisId: ANALYSIS,
        side: 'white',
        classification: 'blunder',
        evalBefore: { cp: null, mate: null },
        evalAfter: { cp: null, mate: null },
      }),
      makeMove(1, { gameId: GAME, analysisId: ANALYSIS, side: 'black', classification: 'best' }),
    ];
    const built = buildAnalysisSummary(noEvalRecords, 'white');
    expect(built.classificationCounts.blunder).toBe(1);
    expect(built.userMoves).toBe(1);
    expect(built.accuracy).toBeNull();
    expect(built.accuracyMoves).toBe(0);
  });
});

describe('buildAnalysisSummary (detection holder: absent vs zero)', () => {
  it('defaults to an absent detection holder (null count and version)', () => {
    const built = buildAnalysisSummary(missedTacticRecords(), 'white');
    expect(built.detectionState).toBe('absent');
    expect(built.missedTacticCount).toBeNull();
    expect(built.detectionVersion).toBeNull();
  });

  it('persists counts + accuracy with a queued pass and no missed-tactic count', () => {
    const built = buildAnalysisSummary(missedTacticRecords(), 'white', {
      detectionState: 'queued',
      missedTacticCount: 0,
    });
    expect(built.detectionState).toBe('queued');
    expect(built.missedTacticCount).toBeNull();
    expect(built.detectionVersion).toBeNull();
    expect(built.classificationCounts.blunder).toBe(1);
    expect(built.accuracyMoves).toBe(2);
  });

  it('keeps a queued/in-progress/failed pass absent even when a number is supplied', () => {
    for (const state of ['queued', 'inProgress', 'failed'] as const) {
      const built = buildAnalysisSummary(missedTacticRecords(), 'white', {
        detectionState: state,
        missedTacticCount: 0,
        detectionVersion: 1,
      });
      expect(built.missedTacticCount, `state ${state}`).toBeNull();
      expect(built.detectionVersion, `state ${state}`).toBeNull();
    }
  });

  it('stores a real zero only for a completed pass that found nothing', () => {
    const built = buildAnalysisSummary(ordinaryGameRecords(GAME, ANALYSIS), 'white', {
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: 1,
    });
    expect(built.detectionState).toBe('completed');
    expect(built.missedTacticCount).toBe(0);
    expect(built.detectionVersion).toBe(1);
  });

  it('derives the completed-pass count from the persisted missedTactic annotations', () => {
    const built = buildAnalysisSummary(missedTacticRecords(), 'white', {
      detectionState: 'completed',
      detectionVersion: 1,
    });
    expect(built.detectionState).toBe('completed');
    expect(built.missedTacticCount).toBe(2);
    expect(built.detectionVersion).toBe(1);
  });

  it('never counts opponent missed-tactic annotations for a completed pass', () => {
    const built = buildAnalysisSummary(missedTacticRecords(), 'black', {
      detectionState: 'completed',
      detectionVersion: 1,
    });
    expect(built.missedTacticCount).toBe(1);
  });

  it('lets an explicit completed-pass count override the annotation-derived value', () => {
    const built = buildAnalysisSummary(missedTacticRecords(), 'white', {
      detectionState: 'completed',
      missedTacticCount: 5,
      detectionVersion: 1,
    });
    expect(built.missedTacticCount).toBe(5);
  });
});

describe('buildAnalysisSummary (immutability)', () => {
  it('does not mutate the records or the options', () => {
    const records = blunderGameRecords(GAME, ANALYSIS);
    const snapshot = structuredClone(records);
    const options = Object.freeze({
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: 1,
    } as const);

    const result = buildAnalysisSummary(freezeRecords(records), 'white', options);
    expect(() => buildAnalysisSummary(freezeRecords(records), 'white', options)).not.toThrow();
    expect(records).toEqual(snapshot);
    expect(result).toEqual(buildAnalysisSummary(records, 'white', { ...options }));
  });
});
