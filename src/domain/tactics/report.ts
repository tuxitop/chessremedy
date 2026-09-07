/**
 * Detection scan report (plan-13 recall diagnostics, option C).
 *
 * Pure summary of one analysis identity's candidate rows, answering "what did
 * the tactics scan actually do?" per game: how many candidate positions Stage
 * 1 produced, how many Stage 2 verified as missed tactics, and — for every
 * candidate that was rejected by a guard — *why*. This is what turns a bare
 * "Missed tactics 0" into something actionable (e.g. "7 positions, 0
 * verified, 7 rejected — 4 no-objective, 2 >8-plies, 1 ambiguous").
 *
 * The function is structural and framework-free: it reads the minimal shape it
 * needs from a candidate row, so it never depends on the persistence layer.
 */

import type { VerificationRejectionReason } from './verify';

/** Structural view of a candidate row the report can read (persistence-agnostic). */
export interface CandidateRowLike {
  readonly verificationStatus: 'raw' | 'failed' | 'verified';
  /** Set only when a Stage-2 guard rejected the candidate (definitive verdict). */
  readonly rejectionReason?: VerificationRejectionReason;
}

/** What one settled detection pass did with a game's candidates. */
export interface ScanPassReport {
  /** Candidate positions Stage 1 emitted for the pass (rows present). */
  readonly examined: number;
  /** Candidates verified as missed tactics. */
  readonly verified: number;
  /** Candidates rejected by a Stage-2 guard (a definitive discard). */
  readonly rejected: number;
  /** Rejection counts by guard reason (plan-13 reasons; see `verify.ts`). */
  readonly rejectedByReason: Partial<Record<VerificationRejectionReason, number>>;
  /**
   * `failed`/`raw` rows that carry no guard reason: engine-failed/deferred
   * candidates, rows left raw by an interrupted pass, or legacy rows created
   * before the rejection reason was recorded. These were not definitively
   * discarded and would be retried by the next scan.
   */
  readonly unresolved: number;
}

export function summarizeCandidateRows(rows: readonly CandidateRowLike[]): ScanPassReport {
  let verified = 0;
  let rejected = 0;
  const rejectedByReason: Partial<Record<VerificationRejectionReason, number>> = {};
  let unresolved = 0;
  for (const row of rows) {
    if (row.verificationStatus === 'verified') {
      verified += 1;
      continue;
    }
    if (row.rejectionReason !== undefined) {
      rejected += 1;
      rejectedByReason[row.rejectionReason] = (rejectedByReason[row.rejectionReason] ?? 0) + 1;
      continue;
    }
    // `failed` without a guard reason or a leftover `raw` row: not settled.
    unresolved += 1;
  }
  return {
    examined: rows.length,
    verified,
    rejected,
    rejectedByReason,
    unresolved,
  };
}
