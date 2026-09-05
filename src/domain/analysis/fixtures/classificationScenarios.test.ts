import { describe, expect, it } from 'vitest';
import { MOVE_CLASSIFICATIONS } from '@/domain/chess';
import type { MoveAnalysis, MoveClassification } from '@/domain/chess';
import { classifyMove, cpValueOf, winPercentFromCp } from '@/domain/chess/classification';
import { summarizeAnalysis } from '../summary';
import {
  blunderGameRecords,
  ordinaryGameRecords,
  fastProfileRecords,
} from './classificationScenarios';

const GAME = 'lichess:fix';
const ANALYSIS = 'a-fix';

/** Reproduce the Feature-008 classification from a record's own fields. */
function classificationOf(record: MoveAnalysis): MoveClassification {
  return classifyMove({
    evalBefore: record.evalBefore,
    evalAfter: record.evalAfter,
    bestMove: record.bestMove,
    playedMove: record.playedMove,
    legalMovesCount: record.legalMovesCount,
    wdlBefore: record.wdlBefore,
    wdlAfter: record.wdlAfter,
    gamePhase: record.gamePhase,
    inBook: record.inBook,
    topCpValues: record.multipvLines.map((line) => cpValueOf(line.evaluation)),
  });
}

function assertWellFormed(records: readonly MoveAnalysis[]): void {
  for (const record of records) {
    expect(MOVE_CLASSIFICATIONS).toContain(record.classification);
    expect(typeof record.classificationVersion).toBe('number');
    expect(typeof record.analysisVersion).toBe('number');
    expect(record.classification).not.toBeNull();
  }
}

describe('classification fixture scenarios (Feature 009)', () => {
  it('produces well-formed MoveAnalysis records with non-null classifications', () => {
    assertWellFormed(blunderGameRecords(GAME, ANALYSIS));
    assertWellFormed(ordinaryGameRecords(GAME, ANALYSIS));
    assertWellFormed(fastProfileRecords(GAME, ANALYSIS));
  });

  it('is deterministic: repeated builds are deep-equal', () => {
    expect(blunderGameRecords(GAME, ANALYSIS)).toEqual(blunderGameRecords(GAME, ANALYSIS));
    expect(ordinaryGameRecords(GAME, ANALYSIS)).toEqual(ordinaryGameRecords(GAME, ANALYSIS));
    expect(fastProfileRecords(GAME, ANALYSIS)).toEqual(fastProfileRecords(GAME, ANALYSIS));
  });

  it('is good-heavy: most ordinary (incl. opening) moves are the good bucket', () => {
    const records = ordinaryGameRecords(GAME, ANALYSIS);
    const summary = summarizeAnalysis(records, 'white');
    const goodShare = summary.user.good / summary.userMoves;
    expect(goodShare).toBeGreaterThan(0.5);
    // The first plies (opening/book-like ordinary moves) stay unemphasized.
    for (let ply = 0; ply < 6; ply += 1) {
      expect(records[ply]!.classification).toBe('good');
    }
    // User classification count is known exactly.
    expect(summary.user).toEqual({ best: 1, good: 4, inaccuracy: 1, mistake: 0, blunder: 0 });
    expect(summary.opponent).toEqual({ best: 0, good: 5, inaccuracy: 0, mistake: 1, blunder: 0 });
  });

  it('stored classifications match what the canonical classifier would produce', () => {
    const fixtures = [
      ...blunderGameRecords(GAME, ANALYSIS),
      ...ordinaryGameRecords(GAME, ANALYSIS),
      ...fastProfileRecords(GAME, ANALYSIS),
    ];
    for (const record of fixtures) {
      expect(classificationOf(record)).toBe(record.classification);
    }
  });

  it('keeps the fast-profile fixture on the centipawn fallback (wdl null)', () => {
    for (const record of fastProfileRecords(GAME, ANALYSIS)) {
      expect(record.wdlBefore).toBeNull();
      expect(record.wdlAfter).toBeNull();
      expect(record.engine.profile).toBe('fast');
      expect(classificationOf(record)).toBe(record.classification);
    }
  });

  it('models the blunder fixture as ordinary/blunder/best (ADR-023 semantics)', () => {
    const records = blunderGameRecords(GAME, ANALYSIS);
    expect(records.map((r) => r.classification)).toEqual(['good', 'good', 'blunder', 'best']);
    // 2.g4 allows a mate — win% collapses toward zero for White.
    const g4 = records[2]!;
    expect(g4.classification).toBe('blunder');
    const loss = winPercentFromCp(0) - winPercentFromCp(-10000);
    expect(loss).toBeGreaterThan(40);
  });
});
