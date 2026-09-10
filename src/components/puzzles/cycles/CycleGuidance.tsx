import type * as React from 'react';
import {
  FIRST_CYCLE_FIRST_TRY_BAND,
  WOODPECKER_PLAN_CYCLES,
  cycleTimeGoal,
  type CycleMetrics,
  type CycleTimeGoal,
} from '@/domain/training';
import { formatDurationMs, formatPercent } from './labels';
import styles from './CycleGuidance.module.css';

export interface CycleGuidanceProps {
  /** The current cycle's canonical aggregates. */
  readonly metrics: CycleMetrics;
  /** The previous cycle's metrics, or `null` for the first cycle. */
  readonly previous: CycleMetrics | null;
  /** The previous cycle's number, or `null` for the first cycle. */
  readonly previousCycleNumber: number | null;
  readonly cycleNumber: number;
  /** Informational plan; defaults to the optional `~6`-cycle suggestion. */
  readonly plannedCycles?: number | null;
  readonly testId?: string;
}

/**
 * The Woodpecker guidance for one cycle: the total solving time and its delta vs
 * the previous cycle with the "beat half the previous cycle's time" target, the
 * 60–75% first-cycle first-try band, and the optional `~6`-cycle plan. All of
 * it is text guidance, never a gate, and never colour-only. The time-halving
 * target is announced politely.
 */
export function CycleGuidance({
  metrics,
  previous,
  previousCycleNumber,
  cycleNumber,
  plannedCycles = null,
  testId = 'cycle-guidance',
}: CycleGuidanceProps): React.JSX.Element {
  const goal = cycleTimeGoal(metrics, previous);
  const suggested = plannedCycles === null;
  const planned = plannedCycles ?? WOODPECKER_PLAN_CYCLES;

  return (
    <div className={styles.wrap} data-testid={testId}>
      <p
        className={styles.line}
        role="status"
        aria-live="polite"
        data-testid={`${testId}-time-goal`}
      >
        {timeGoalText(goal, previousCycleNumber)}
      </p>
      <p className={styles.line} data-testid={`${testId}-band`}>
        {bandText(metrics.firstTryAccuracy, cycleNumber)}
      </p>
      <p className={styles.line} data-testid={`${testId}-plan`}>
        {planText(cycleNumber, planned, suggested)}
      </p>
      <p className={styles.note} data-testid={`${testId}-note`}>
        This is guidance only. The app never blocks a cycle on time, accuracy or a cycle target.
      </p>
    </div>
  );
}

/** The total-time line: measured value, previous delta and the half-time target. */
function timeGoalText(goal: CycleTimeGoal, previousCycleNumber: number | null): string {
  const current = goal.currentMeasured
    ? `Total solving time: ${formatDurationMs(goal.currentTotalMs)}.`
    : 'Total solving time: no completed puzzles yet, so none is shown.';
  if (previousCycleNumber === null) {
    return `${current} This is the first cycle; later cycles target beating half the previous cycle's time.`;
  }
  if (goal.previousTotalMs === null) {
    return `${current} The previous cycle recorded no solving time, so there is no time target yet.`;
  }
  const delta = signedDuration(goal.deltaMs);
  const target = formatDurationMs(goal.targetMs ?? 0);
  return `${current} Previous cycle (cycle ${previousCycleNumber}): ${formatDurationMs(
    goal.previousTotalMs,
  )} (change ${delta}). Target: beat ${target} — half the previous cycle's time.`;
}

/** The first-cycle first-try band as text, with this cycle's position when known. */
function bandText(value: number | null, cycleNumber: number): string {
  const band = `${Math.round(FIRST_CYCLE_FIRST_TRY_BAND.min * 100)}–${Math.round(
    FIRST_CYCLE_FIRST_TRY_BAND.max * 100,
  )}%`;
  if (cycleNumber !== 1) {
    return `First-try guidance (first cycle): aim for ${band}. Guidance only — there is no accuracy gate.`;
  }
  if (value === null) {
    return `First-try guidance (first cycle): aim for ${band}. No completed puzzles yet, so no first-try rate is shown.`;
  }
  const position =
    value < FIRST_CYCLE_FIRST_TRY_BAND.min
      ? 'below'
      : value > FIRST_CYCLE_FIRST_TRY_BAND.max
        ? 'above'
        : 'within';
  return `First-try guidance (first cycle): aim for ${band}. This cycle is at ${
    formatPercent(value) ?? '—'
  }, ${position} the band. Guidance only — there is no accuracy gate.`;
}

/** The optional cycle-plan suggestion. */
function planText(cycleNumber: number, planned: number, suggested: boolean): string {
  const label = suggested ? `~${planned}` : String(planned);
  return `Cycle ${cycleNumber} of ${label}. The ${label}-cycle plan is optional guidance, not a requirement.`;
}

/** A signed duration (`−` for faster); `null` is an undefined difference. */
function signedDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '';
  return `${sign}${formatDurationMs(Math.abs(ms))}`;
}
