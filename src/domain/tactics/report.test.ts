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
    });
  });

  it('counts verified vs guard-rejected candidates grouped by reason', () => {
    const report = summarizeCandidateRows([
      row('verified'),
      row('verified'),
      row('failed', { rejectionReason: 'no-objective' }),
      row('failed', { rejectionReason: 'no-objective' }),
      row('failed', { rejectionReason: 'no-objective' }),
      row('failed', { rejectionReason: 'best-move-not-unique' }),
      row('failed', { rejectionReason: '>8-plies' }),
    ]);
    expect(report.examined).toBe(7);
    expect(report.verified).toBe(2);
    expect(report.rejected).toBe(5);
    expect(report.rejectedByReason).toEqual({
      'no-objective': 3,
      'best-move-not-unique': 1,
      '>8-plies': 1,
    });
    expect(report.unresolved).toBe(0);
  });

  it('counts engine-failed / leftover-raw / legacy rows as unresolved', () => {
    const report = summarizeCandidateRows([
      row('raw'),
      row('failed'), // no rejectionReason: engine-failed, deferred or legacy
      row('verified'),
    ]);
    expect(report.verified).toBe(1);
    expect(report.rejected).toBe(0);
    expect(report.unresolved).toBe(2);
  });

  it('never mutates its input', () => {
    const rows: readonly CandidateRowLike[] = [
      row('failed', { rejectionReason: 'no-objective' }),
      row('verified'),
    ];
    summarizeCandidateRows(rows);
    expect(rows[0]!.rejectionReason).toBe('no-objective');
  });
});
