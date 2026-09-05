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
