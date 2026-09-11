/**
 * Feature 015 — chart-card state mapping (presentation only, no React).
 *
 * A chart with no plottable `ok` point renders an explicit honest-state
 * placeholder instead of an empty axis. This reads the Feature-014 `MetricState`
 * values verbatim: it derives no statistic and fabricates no zero.
 */

import type { MetricState } from '@/domain/statistics';
import {
  EMPTY_STATE_LABEL,
  NOT_DETECTED_STATE_LABEL,
  insufficientLabel,
} from '@/presentation/dashboard';

/** The card-level state: `ok` only when at least one point is plottable. */
export type ChartCardState = MetricState;

/**
 * Reduce the per-point states to one card state. Any `ok` point means the chart
 * is plottable; otherwise the most specific non-ok state is surfaced
 * (`notDetected` before `insufficient` before `empty`).
 */
export function chartStateFromPoints(states: readonly MetricState[]): ChartCardState {
  if (states.length === 0) {
    return 'empty';
  }
  if (states.some((state) => state === 'ok')) {
    return 'ok';
  }
  if (states.some((state) => state === 'notDetected')) {
    return 'notDetected';
  }
  if (states.some((state) => state === 'insufficient')) {
    return 'insufficient';
  }
  return 'empty';
}

/** The explicit placeholder text for a non-`ok` card state. */
export function chartStateLabel(state: ChartCardState, n = 0): string | null {
  switch (state) {
    case 'ok':
      return null;
    case 'insufficient':
      return insufficientLabel(n);
    case 'empty':
      return EMPTY_STATE_LABEL;
    case 'notDetected':
      return NOT_DETECTED_STATE_LABEL;
  }
}
