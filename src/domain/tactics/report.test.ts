/**
 * Scan-pass report tests (plan-13 recall diagnostics, option C).
 *
 * Pure counts over candidate-row shapes: examined / verified / rejected
 * (by reason) / unresolved. Deterministic fixtures mirror what the detection
 * service persists.
 */

import { describe, expect, it } from 'vitest';
import { summarizeCandidateRows } from './report';
import type { CandidateRowLike } from './report';

function row(
  status: CandidateRowLike['verificationStatus'],
  overrides: Partial<CandidateRowLike> = {},
): CandidateRowLike {
  return { verificationStatus: status, ...overrides };
}

describe('summarizeCandidateRows (scan report)', () => {
  it('reports an empty pass', () => {
    expect(summarizeCandidateRows([])).toEqual({
      examined: 0,
      verified: 0,
      rejected: 0,
      rejectedByReason: {},
      unresolved: 0,
      bestMoves: [],
    });
  });

  it('counts verified vs guard-rejected candidates grouped by reason', () => {
    const report = summarizeCandidateRows([
      row('verified', { sourcePly: 0 }),
      row('verified', { sourcePly: 2 }),
      row('failed', {
        sourcePly: 6,
        rejectionReason: 'no-objective',
        verificationTopLine: { move: 'd2d4' },
      }),
      row('failed', { sourcePly: 8, rejectionReason: 'no-objective' }),
      row('failed', { sourcePly: 10, rejectionReason: 'no-objective' }),
      row('failed', {
        sourcePly: 12,
        rejectionReason: '>8-plies',
        verificationTopLine: { move: 'g5f7' },
      }),
      row('failed', { sourcePly: 14, rejectionReason: 'wdl-inconsistent' }),
    ]);
    expect(report.examined).toBe(7);
    expect(report.verified).toBe(2);
    expect(report.rejected).toBe(5);
    expect(report.rejectedByReason).toEqual({
      'no-objective': 3,
      '>8-plies': 1,
      'wdl-inconsistent': 1,
    });
    expect(report.unresolved).toBe(0);
    // Engine top move is retained only when the row stored one.
    expect(report.bestMoves).toEqual([
      { sourcePly: 6, reason: 'no-objective', move: 'd2d4' },
      { sourcePly: 12, reason: '>8-plies', move: 'g5f7' },
    ]);
  });

  it('counts engine-failed / leftover-raw / legacy rows as unresolved', () => {
    const report = summarizeCandidateRows([
      row('raw', { sourcePly: 4 }),
      row('failed', { sourcePly: 6 }), // no rejectionReason: engine-failed, deferred or legacy
      row('verified', { sourcePly: 8 }),
    ]);
    expect(report.verified).toBe(1);
    expect(report.rejected).toBe(0);
    expect(report.unresolved).toBe(2);
    expect(report.bestMoves).toEqual([]);
  });

  it('never mutates its input', () => {
    const rows: readonly CandidateRowLike[] = [
      row('failed', { sourcePly: 6, rejectionReason: 'no-objective' }),
      row('verified', { sourcePly: 8 }),
    ];
    summarizeCandidateRows(rows);
    expect(rows[0]!.rejectionReason).toBe('no-objective');
  });
});
