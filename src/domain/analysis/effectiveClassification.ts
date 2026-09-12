/**
 * Missed-tactic exclusivity derivation (ADR-023 amendment, W3).
 *
 * A ply whose persisted `MoveAnalysis` carries a **current-version verified
 * missed tactic** (`missedTactic === true` and `detectionVersion` equal to the
 * current `DETECTION_VERSION`) has the derived effective classification state
 * `'missedTactic'`:
 *
 * - it is a **presentation/statistics** state, not a sixth persisted
 *   `MoveClassification` and not a `classificationVersion` change;
 * - the raw ADR-023 `classification` is retained as provenance and returned
 *   for every non-exclusive (or stale) record, so the freshness fallback is
 *   automatic;
 * - it is suppressed from the five classification buckets, the error rates and
 *   the phase error numerators, but stays in the move-exposure denominators and
 *   in the ADR-024 accuracy set.
 *
 * The predicate gates on the record's own flag/version. The candidate rules and
 * the annotation service emit user plies only; callers apply the predicate on
 * the user's side (the count loops already separate user from opponent), so an
 * opponent ply that carries a stray flag is never treated as exclusive.
 *
 * Pure and framework-free: no React, Dexie, Worker or engine import.
 */

import type { MoveAnalysis, MoveClassification } from '@/domain/chess';

/** The effective presentation/statistics state of an analyzed ply. */
export type EffectiveClassification = MoveClassification | 'missedTactic';

/**
 * `true` only for a record carrying a current-version verified missed tactic.
 * `currentDetectionVersion` is the caller's `DETECTION_VERSION`; a stale marker
 * (`detectionVersion !== currentDetectionVersion`) is not exclusive.
 */
export function isExclusiveMissedTactic(
  record: MoveAnalysis,
  currentDetectionVersion: number,
): boolean {
  return record.missedTactic === true && record.detectionVersion === currentDetectionVersion;
}

/**
 * `'missedTactic'` for a current-version verified miss, otherwise the raw
 * persisted ADR-023 classification (so a stale flag falls back automatically).
 */
export function effectiveClassificationOf(
  record: MoveAnalysis,
  currentDetectionVersion: number,
): EffectiveClassification {
  return isExclusiveMissedTactic(record, currentDetectionVersion)
    ? 'missedTactic'
    : record.classification;
}
