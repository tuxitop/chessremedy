/**
 * Feature 014 — aggregate state contract (pure).
 *
 * The single place that turns a raw value and its honest sample size into a
 * canonical `Aggregate`: `ok` at `n >= MIN_SAMPLE_SIZE`, `insufficient` with
 * the value still returned when `0 < n < MIN_SAMPLE_SIZE`, `empty` when
 * `n === 0` (value `null`), and a separate `notDetected` for missed-tactic
 * metrics. Values are always raw/full precision — rounding is presentation.
 *
 * No React, Dexie, Worker or engine import.
 */

import type { AccuracyAggregate, Aggregate, MetricState, SampleUnit } from './types';
import { MIN_SAMPLE_SIZE } from './types';

/** Canonical `empty` aggregate for a sample unit. */
export function emptyAggregate(unit: SampleUnit): Aggregate {
  return { value: null, state: 'empty', sample: { unit, n: 0 } };
}

/** Canonical `notDetected` aggregate (missed-tactic metrics only). */
export function notDetectedAggregate(unit: SampleUnit): Aggregate {
  return { value: null, state: 'notDetected', sample: { unit, n: 0 } };
}

/** State derived from a sample size at the `MIN_SAMPLE_SIZE` boundary. */
export function stateOf(n: number): MetricState {
  if (n <= 0) {
    return 'empty';
  }
  if (n < MIN_SAMPLE_SIZE) {
    return 'insufficient';
  }
  return 'ok';
}

/**
 * Build an aggregate from a raw value and its sample size. A `null` value or
 * a non-positive `n` yields `empty` (never a fabricated zero).
 */
export function aggregateOf(value: number | null, n: number, unit: SampleUnit): Aggregate {
  if (value === null || n <= 0) {
    return emptyAggregate(unit);
  }
  return { value, state: stateOf(n), sample: { unit, n } };
}

/** A ratio `numerator / denominator`; `empty` when there is no denominator. */
export function rate(numerator: number, denominator: number, unit: SampleUnit): Aggregate {
  if (denominator <= 0) {
    return emptyAggregate(unit);
  }
  return aggregateOf(numerator / denominator, denominator, unit);
}

/** A share `part / whole`; `empty` when there is no whole. */
export function share(part: number, whole: number, unit: SampleUnit): Aggregate {
  if (whole <= 0) {
    return emptyAggregate(unit);
  }
  return aggregateOf(part / whole, whole, unit);
}

/**
 * Median of a numeric sample (even samples average the two middle values).
 * The sample size is the number of observations; an empty sample is `empty`.
 */
export function median(values: readonly number[], unit: SampleUnit): Aggregate {
  if (values.length === 0) {
    return emptyAggregate(unit);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  const value = sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
  return aggregateOf(value, sorted.length, unit);
}

/** One observation in the ADR-024 move-weighted accuracy mean. */
export interface AccuracyObservation {
  readonly accuracy: number | null;
  readonly weightMoves: number;
}

/**
 * ADR-024 move-weighted aggregate accuracy:
 * `Σ(accuracy_i × accuracyMoves_i) / Σ(accuracyMoves_i)`. `sample.unit` is
 * `games`, `sample.n` is the number of games with a non-null accuracy, and
 * `weightMoves` exposes the weighting denominator. Games with a `null`
 * accuracy contribute nothing (not a zero).
 */
export function accuracyAggregate(observations: readonly AccuracyObservation[]): AccuracyAggregate {
  let n = 0;
  let weightMoves = 0;
  let weightedSum = 0;
  for (const observation of observations) {
    if (observation.accuracy === null) {
      continue;
    }
    n += 1;
    weightMoves += observation.weightMoves;
    weightedSum += observation.accuracy * observation.weightMoves;
  }
  const value = weightMoves > 0 ? weightedSum / weightMoves : null;
  return {
    value,
    state: value === null || n === 0 ? 'empty' : stateOf(n),
    sample: { unit: 'games', n },
    weightMoves,
  };
}
