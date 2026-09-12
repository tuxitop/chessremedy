/**
 * Feature 018 — Home "continue where you left off" selector (pure, no React).
 *
 * Deterministic composition over the persisted Feature-013 rows Home already
 * reads. It resolves exactly one of: the most recent `inProgress` cycle
 * (including the reserved Quick-train sentinel), else the single open
 * Woodpecker block, else the most recently active custom set, else `none`.
 * `abandoned`/`completed` cycles are never chosen and no progress value is
 * derived here (Feature 014/013 own every number).
 */

import { QUICK_TRAIN_SET_ID } from '@/domain/training/autoSet';
import type { TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training/cycleTypes';
import { selectDefaultTrainingSet } from '@/presentation/dashboard/selection';

/** Human label used for a cycle whose owning set row does not exist (Quick train). */
export const QUICK_TRAIN_LABEL = 'Quick train';

/**
 * The resolved continue target. `cycle` carries the set id + 1-based cycle
 * number; `block`/`set` carry the set id; `none` means no resumable target.
 * `label` is the owning set's name, or `"Quick train"` for the sentinel.
 */
export type HomeContinueTarget =
  | {
      readonly kind: 'cycle';
      readonly setId: string;
      readonly cycleNumber: number;
      readonly label: string;
      readonly quickTrain: boolean;
    }
  | { readonly kind: 'block'; readonly setId: string; readonly label: string }
  | { readonly kind: 'set'; readonly setId: string; readonly label: string }
  | { readonly kind: 'none' };

/** Inputs to `resolveHomeContinue`: every set (active + archived), the open block, every cycle. */
export interface HomeContinueInput {
  readonly sets: readonly TacticalTrainingSetRow[];
  readonly openBlock: TacticalTrainingSetRow | null;
  readonly cycles: readonly TrainingCycleRow[];
}

/** Stable text comparison for the `cycleId` ascending tie-break. */
function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Resolve the single continue target:
 * 1. the `inProgress` cycle with the greatest `startedAt` (tie-break: greater
 *    `cycleNumber`, then `cycleId` ascending);
 * 2. else the single open Woodpecker block;
 * 3. else the most recently active custom set (`source.kind !== 'auto'`,
 *    active before archived, using the Feature-015 recency order);
 * 4. else `none`.
 */
export function resolveHomeContinue(input: HomeContinueInput): HomeContinueTarget {
  const cycle = [...input.cycles]
    .filter((row) => row.status === 'inProgress')
    .sort(
      (a, b) =>
        b.startedAt - a.startedAt || b.cycleNumber - a.cycleNumber || compareText(a.id, b.id),
    )[0];

  if (cycle !== undefined) {
    const quickTrain = cycle.trainingSetId === QUICK_TRAIN_SET_ID;
    const set = input.sets.find((row) => row.id === cycle.trainingSetId);
    return {
      kind: 'cycle',
      setId: cycle.trainingSetId,
      cycleNumber: cycle.cycleNumber,
      label: quickTrain ? QUICK_TRAIN_LABEL : (set?.name ?? QUICK_TRAIN_LABEL),
      quickTrain,
    };
  }

  if (input.openBlock !== null) {
    return { kind: 'block', setId: input.openBlock.id, label: input.openBlock.name };
  }

  const custom = input.sets.filter((row) => row.source.kind !== 'auto');
  const mostRecent = selectDefaultTrainingSet(
    custom.filter((row) => row.status === 'active'),
    custom.filter((row) => row.status === 'archived'),
    undefined,
  );
  if (mostRecent !== null) {
    return { kind: 'set', setId: mostRecent.id, label: mostRecent.name };
  }

  return { kind: 'none' };
}
