/**
 * Feature 016 — training-cycle numbering reconciliation.
 *
 * The `trainingCycles` table declares a **unique** `[trainingSetId + cycleNumber]`
 * index (`schema/v10.ts`). Two devices can independently create a cycle for the
 * same set and both compute the same next number (`max + 1`), so merging the two
 * devices' collections can produce two distinct rows (`id` differs) that share a
 * `(trainingSetId, cycleNumber)` pair. A `bulkPut` of that batch then fails with
 * a `ConstraintError`, aborting the whole sync.
 *
 * A cycle's identity is its `id`; `cycleNumber` is display/ordering metadata and
 * attempts reference `cycleId`, never the number. So the merge keeps the
 * most-recently-updated row on the contested number and moves the others to
 * fresh numbers above the set's current maximum. The rule is deterministic
 * (newer `updatedAt` wins, `id` breaks ties; losers are ordered by `id`) so every
 * device converges on the same numbering without orphaning any attempt.
 *
 * Pure: no Dexie/React/engine import.
 */

import type { TrainingCycleRow } from '@/domain/training';

function compareIds(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Returns the cycles with duplicate `(trainingSetId, cycleNumber)` pairs
 * renumbered so the set is safe to persist under the unique index. The input is
 * not mutated; non-conflicting cycles are returned by reference.
 */
export function normalizeTrainingCycleNumbers(
  cycles: readonly TrainingCycleRow[],
): TrainingCycleRow[] {
  const bySet = new Map<string, TrainingCycleRow[]>();
  for (const cycle of cycles) {
    const list = bySet.get(cycle.trainingSetId);
    if (list === undefined) {
      bySet.set(cycle.trainingSetId, [cycle]);
    } else {
      list.push(cycle);
    }
  }

  const result: TrainingCycleRow[] = [];
  for (const list of bySet.values()) {
    const byNumber = new Map<number, TrainingCycleRow[]>();
    let nextNumber = 0;
    for (const cycle of list) {
      nextNumber = Math.max(nextNumber, cycle.cycleNumber);
      const group = byNumber.get(cycle.cycleNumber);
      if (group === undefined) {
        byNumber.set(cycle.cycleNumber, [cycle]);
      } else {
        group.push(cycle);
      }
    }

    for (const [, group] of [...byNumber.entries()].sort((a, b) => a[0] - b[0])) {
      if (group.length === 1) {
        result.push(group[0] as TrainingCycleRow);
        continue;
      }
      const ranked = [...group].sort((a, b) => b.updatedAt - a.updatedAt || compareIds(a.id, b.id));
      // The winner keeps the contested number; every other row gets a fresh one.
      result.push(ranked[0] as TrainingCycleRow);
      for (const loser of ranked.slice(1)) {
        nextNumber += 1;
        result.push({ ...loser, cycleNumber: nextNumber });
      }
    }
  }
  return result;
}
