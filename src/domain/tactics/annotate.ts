/**
 * Tactical detection annotation (Feature 010).
 *
 * Pure, immutable merge of the verified-miss flag onto the owning
 * `MoveAnalysis` plies. A record whose `[analysisId, ply]` matches a verified
 * candidate's `[analysisId, sourcePly]` is re-created with
 * `missedTactic: true` and `detectionVersion`; every other record is returned
 * by reference.
 */

import type { MoveAnalysis } from '@/domain/chess';
import type { VerifiedTacticalCandidate } from './types';

export function annotateVerifiedMisses(
  records: readonly MoveAnalysis[],
  verified: readonly VerifiedTacticalCandidate[],
  detectionVersion: number,
): MoveAnalysis[] {
  const missed = new Set<string>();
  for (const candidate of verified) {
    missed.add(`${candidate.analysisId}:${candidate.sourcePly}`);
  }
  return records.map((record) => {
    if (!missed.has(`${record.analysisId}:${record.ply}`)) {
      return record;
    }
    return { ...record, missedTactic: true, detectionVersion };
  });
}

/**
 * Clear missed-tactic annotations that were produced by an **older** detection
 * pipeline version. A record that is flagged but whose `detectionVersion` is
 * not the current one is stale: the pass that wrote it ran under rules that no
 * longer apply, and its verdict cannot be trusted or merged. Such a record is
 * re-created with `missedTactic: false` / `detectionVersion: null`; every other
 * record (unflagged, or flagged by the current version) is returned by
 * reference. Used at the start of a detection pass so a re-run never merges
 * stale flags into a freshly derived result.
 */
export function clearMissedTacticAnnotations(
  records: readonly MoveAnalysis[],
  currentVersion: number,
): MoveAnalysis[] {
  return records.map((record) => {
    if (record.missedTactic && record.detectionVersion !== currentVersion) {
      return { ...record, missedTactic: false, detectionVersion: null };
    }
    return record;
  });
}
