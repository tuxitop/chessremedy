/**
 * Verified-miss annotation tests (Feature 010). Exercises the pure merge of
 * `missedTactic`/`detectionVersion` onto the owning `MoveAnalysis` plies.
 */

import { describe, expect, it } from 'vitest';
import type { Color } from 'chessops/types';
import type { MoveAnalysis } from '@/domain/chess';
import { makeMove } from '../analysis/test-support';
import { annotateVerifiedMisses, clearMissedTacticAnnotations } from './annotate';
import { generateCandidates } from './stage1';
import { DETECTION_VERSION } from './types';
import type { VerifiedTacticalCandidate } from './types';

const ANALYSIS = 'analysis-1';
const OTHER_ANALYSIS = 'analysis-2';
const GAME = 'lichess:game1';
const NOW = 1_700_000_000_000;

const STARTING_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

function missRecord(ply: number, side: Color, analysisId = ANALYSIS): MoveAnalysis {
  return makeMove(ply, {
    gameId: GAME,
    analysisId,
    side,
    playedMove: { san: 'd3', uci: 'd2d3' },
    bestMove: { san: 'Nxe5', uci: 'f3e5' },
    bestPv: ['f3e5', 'd7d6'],
    positionFen: STARTING_FEN,
    evalBefore: { cp: 300, mate: null },
    evalAfter: { cp: 0, mate: null },
    classification: 'blunder',
  });
}

function verifiedFor(
  record: MoveAnalysis,
  analysisId = record.analysisId,
): VerifiedTacticalCandidate {
  const raw = generateCandidates([record], record.side, NOW)[0]!;
  return {
    ...raw,
    analysisId,
    tacticalObjective: 'winning_material',
    candidateSolutionLength: 2,
    verificationMetadata: {
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
      analysisVersion: 1,
      verificationDepth: 22,
      verificationTimestamp: NOW + 1,
      wdlAfterBestLine: { w: 980, d: 15, l: 5 },
    },
    detectionVersion: DETECTION_VERSION,
    verificationStatus: 'verified',
  };
}

describe('annotateVerifiedMisses', () => {
  it('sets missedTactic/detectionVersion on matching plies only and keeps other references', () => {
    const miss = missRecord(4, 'white');
    const ordinary = missRecord(6, 'white');
    const records = [miss, ordinary];

    const result = annotateVerifiedMisses(records, [verifiedFor(miss)], DETECTION_VERSION);

    expect(result).toHaveLength(records.length);
    expect(result).not.toBe(records);
    expect(result[0]).not.toBe(miss);
    expect(result[0]!.missedTactic).toBe(true);
    expect(result[0]!.detectionVersion).toBe(DETECTION_VERSION);
    expect(result[0]!.playedMove).toEqual({ san: 'd3', uci: 'd2d3' });
    expect(result[1]).toBe(ordinary);
    expect(miss.missedTactic).toBe(false);
    expect(miss.detectionVersion).toBeNull();
  });

  it('matches on the [analysisId, ply] key regardless of the candidate order', () => {
    const miss = missRecord(4, 'white');
    const ordinary = missRecord(6, 'white');
    const records = [ordinary, miss];

    const result = annotateVerifiedMisses(records, [verifiedFor(miss)], DETECTION_VERSION);

    expect(result[0]).toBe(ordinary);
    expect(result[1]!.missedTactic).toBe(true);
    expect(result[1]!.detectionVersion).toBe(DETECTION_VERSION);
  });

  it('does not annotate a ply when the analysis id differs', () => {
    const miss = missRecord(4, 'white', ANALYSIS);
    const records = [miss];

    const result = annotateVerifiedMisses(
      records,
      [verifiedFor(missRecord(4, 'white', OTHER_ANALYSIS), OTHER_ANALYSIS)],
      DETECTION_VERSION,
    );

    expect(result[0]).toBe(miss);
    expect(result[0]!.missedTactic).toBe(false);
    expect(result[0]!.detectionVersion).toBeNull();
  });

  it('returns the input records untouched when no candidate matches', () => {
    const records = [missRecord(4, 'white'), missRecord(6, 'white')];
    const noMatch = verifiedFor(missRecord(8, 'white'));
    const result = annotateVerifiedMisses(records, [noMatch], DETECTION_VERSION);
    expect(result).toEqual(records);
    expect(result[0]).toBe(records[0]);
    expect(result[1]).toBe(records[1]);
  });

  it('accepts an empty verified list and changes nothing', () => {
    const records = [missRecord(4, 'white'), missRecord(6, 'black')];
    const result = annotateVerifiedMisses(records, [], DETECTION_VERSION);
    expect(result).toEqual(records);
    expect(result[0]).toBe(records[0]);
    expect(result[1]).toBe(records[1]);
  });

  it('annotates plies matching across mixed colors', () => {
    const whiteMiss = missRecord(4, 'white');
    const blackMiss = missRecord(5, 'black');
    const records = [whiteMiss, blackMiss];

    const result = annotateVerifiedMisses(
      records,
      [verifiedFor(whiteMiss), verifiedFor(blackMiss)],
      DETECTION_VERSION,
    );

    expect(result[0]!.missedTactic).toBe(true);
    expect(result[1]!.missedTactic).toBe(true);
    expect(result[0]!.detectionVersion).toBe(DETECTION_VERSION);
    expect(result[1]!.detectionVersion).toBe(DETECTION_VERSION);
  });
});

describe('clearMissedTacticAnnotations', () => {
  it('clears only records flagged by an older detection version', () => {
    const current = missRecord(4, 'white');
    const annotatedCurrent = {
      ...current,
      missedTactic: true,
      detectionVersion: DETECTION_VERSION,
    };
    const stale = missRecord(6, 'white');
    const annotatedStale = { ...stale, missedTactic: true, detectionVersion: 1 };
    const clean = missRecord(8, 'white');
    const records = [annotatedCurrent, annotatedStale, clean];

    const result = clearMissedTacticAnnotations(records, DETECTION_VERSION);

    expect(result[0]).toBe(annotatedCurrent);
    expect(result[0]!.missedTactic).toBe(true);
    expect(result[1]).not.toBe(annotatedStale);
    expect(result[1]!.missedTactic).toBe(false);
    expect(result[1]!.detectionVersion).toBeNull();
    expect(result[2]).toBe(clean);
  });

  it('leaves a flagged record untouched when its version is already current', () => {
    const record = {
      ...missRecord(4, 'white'),
      missedTactic: true,
      detectionVersion: DETECTION_VERSION,
    };
    const result = clearMissedTacticAnnotations([record], DETECTION_VERSION);
    expect(result[0]).toBe(record);
    expect(result[0]!.missedTactic).toBe(true);
  });

  it('clears a stale flag even when detectionVersion is null (annotated without a pass)', () => {
    const record = missRecord(4, 'white');
    const nullAnnotated = { ...record, missedTactic: true, detectionVersion: null };
    const result = clearMissedTacticAnnotations([nullAnnotated], DETECTION_VERSION);
    expect(result[0]).not.toBe(nullAnnotated);
    expect(result[0]!.missedTactic).toBe(false);
    expect(result[0]!.detectionVersion).toBeNull();
  });
});
