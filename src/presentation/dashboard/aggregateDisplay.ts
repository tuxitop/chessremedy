/**
 * Feature 015 — honest-state aggregate display mapping (pure, no React).
 *
 * The single mapping every dashboard card/tooltip uses to turn a Feature-014
 * `Aggregate` into display text. It reads `state`/`sample`/`value` verbatim:
 * it never derives a state from a number and never calls the Feature-014
 * aggregate constructors. `ok` shows the formatted value; every other state
 * hides the value and shows an explicit text placeholder (absent is never a
 * fabricated `0`).
 */

import type { Aggregate, MetricState, SampleUnit } from '@/domain/statistics';
import { formatSample } from './formatters';

/** Formats one raw aggregate value for display (never rounds the domain value). */
export type AggregateValueFormatter = (value: number) => string;

/** Presentation descriptor for one aggregate. */
export interface AggregateDisplay {
  readonly state: MetricState;
  /** True when the value must not be shown (insufficient/empty/notDetected). */
  readonly hidden: boolean;
  /** Formatted value text for `ok`; `null` when hidden. */
  readonly text: string | null;
  /** Explicit state placeholder text for non-`ok`; `null` for `ok`. */
  readonly stateLabel: string | null;
  readonly n: number;
  readonly unit: SampleUnit;
  /** `n = X <unit>` label (always shown alongside an `ok` value). */
  readonly sampleLabel: string;
}

/** Text shown for an `empty` aggregate. */
export const EMPTY_STATE_LABEL = 'No data';
/** Text shown for a `notDetected` missed-tactic aggregate. */
export const NOT_DETECTED_STATE_LABEL = 'Tactics not scanned';
/** Text prefix shown for an `insufficient` aggregate. */
export const INSUFFICIENT_STATE_PREFIX = 'Insufficient data';

/** The explicit `Insufficient data (n = X)` placeholder. */
export function insufficientLabel(n: number): string {
  return `${INSUFFICIENT_STATE_PREFIX} (n = ${n})`;
}

/**
 * Map an `Aggregate` to its display descriptor.
 *
 * | State          | hidden | text          | stateLabel                    |
 * | -------------- | ------ | ------------- | ----------------------------- |
 * | `ok`           | false  | `format(value)` | `null`                      |
 * | `insufficient` | true   | `null`        | `Insufficient data (n = X)`   |
 * | `empty`        | true   | `null`        | `No data`                     |
 * | `notDetected`  | true   | `null`        | `Tactics not scanned`         |
 */
export function aggregateDisplay(
  aggregate: Aggregate,
  format: AggregateValueFormatter,
): AggregateDisplay {
  const { n, unit } = aggregate.sample;
  const sampleLabel = formatSample(n, unit);
  switch (aggregate.state) {
    case 'ok':
      return {
        state: aggregate.state,
        hidden: false,
        text: aggregate.value === null ? null : format(aggregate.value),
        stateLabel: null,
        n,
        unit,
        sampleLabel,
      };
    case 'insufficient':
      return {
        state: aggregate.state,
        hidden: true,
        text: null,
        stateLabel: insufficientLabel(n),
        n,
        unit,
        sampleLabel,
      };
    case 'empty':
      return {
        state: aggregate.state,
        hidden: true,
        text: null,
        stateLabel: EMPTY_STATE_LABEL,
        n,
        unit,
        sampleLabel,
      };
    case 'notDetected':
      return {
        state: aggregate.state,
        hidden: true,
        text: null,
        stateLabel: NOT_DETECTED_STATE_LABEL,
        n,
        unit,
        sampleLabel,
      };
  }
}
