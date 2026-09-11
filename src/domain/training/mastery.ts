/**
 * Feature 013 — canonical puzzle-mastery derivation (domain, pure).
 *
 * Mastery is a derived, monotonic, global (per-puzzle, across all sets/cycles)
 * read model: a puzzle is mastered after a **legitimate first-try solve in 3
 * distinct cycles** (`domain/tactical-training.md`). It is never stored on the
 * puzzle or any row (ADR-031); this module is the single canonical function
 * shared by Feature 013 (auto-set retirement) and Feature 014 (mastered
 * counts). No React, Dexie, engine or network import.
 *
 * A legitimate first try is the cycle's first presentation solved cleanly —
 * no hint, no wrong move and no restart. A retry presentation
 * (`presentationIndex === 2`) never credits, and rows for another puzzle or with
 * a missing/blank `cycleId` are ignored. A row whose `cycleId` has no matching
 * `trainingCycles` row is **orphaned** and never credits: the caller passes the
 * known cycles, so a stale attempt cannot earn mastery after its cycle is gone.
 */

import type { TrainingCycleRow } from './cycleTypes';
import type { PuzzleAttemptRow } from './types';

/** Number of distinct-cycle legitimate first-try solves required to master. */
export const MASTERY_REQUIRED_CYCLES = 3;

/**
 * Version of the mastery derivation (threshold, legitimate-solve conditions and
 * distinct-cycle rule). Bump when any of those semantics change
 * (`domain/tactical-training.md`, Feature 013 §12).
 */
export const MASTERY_VERSION = 1;

/**
 * Whether an attempt is a legitimate first-try solve: the cycle's **first**
 * presentation, solved first try, with no hint, no wrong move and no restart.
 *
 * `restartCount` is read defensively as `?? 0` so legacy rows without the field
 * stay valid; every other counter is checked exactly, so a malformed row never
 * earns a credit.
 */
export function isLegitimateFirstTry(attempt: PuzzleAttemptRow): boolean {
  return (
    attempt.presentationIndex === 1 &&
    attempt.result === 'solvedFirstTry' &&
    attempt.hintCount === 0 &&
    attempt.wrongMoveCount === 0 &&
    (attempt.restartCount ?? 0) === 0
  );
}

/**
 * Group the distinct `cycleId`s of each puzzle's legitimate first-try rows.
 * Retry presentations, non-clean rows and malformed rows (missing puzzle id or
 * blank cycle id) are skipped, as are orphaned rows whose `cycleId` is not in
 * `knownCycleIds`.
 */
function legitimateCycleIdsByPuzzle(
  attempts: readonly PuzzleAttemptRow[],
  knownCycleIds: ReadonlySet<string>,
): Map<string, Set<string>> {
  const byPuzzle = new Map<string, Set<string>>();
  for (const attempt of attempts) {
    if (!isLegitimateFirstTry(attempt)) {
      continue;
    }
    const puzzleId = attempt.puzzleId;
    const cycleId = attempt.cycleId;
    if (typeof puzzleId !== 'string' || puzzleId.length === 0) {
      continue;
    }
    if (typeof cycleId !== 'string' || cycleId.length === 0) {
      continue;
    }
    if (!knownCycleIds.has(cycleId)) {
      continue;
    }
    let cycles = byPuzzle.get(puzzleId);
    if (cycles === undefined) {
      cycles = new Set<string>();
      byPuzzle.set(puzzleId, cycles);
    }
    cycles.add(cycleId);
  }
  return byPuzzle;
}

/** The set of persisted cycle ids `attempts` may legitimately credit. */
function knownCycleIdsOf(cycles: readonly TrainingCycleRow[]): ReadonlySet<string> {
  return new Set(cycles.map((cycle) => cycle.id));
}

/**
 * Whether `puzzleId` is mastered: at least `MASTERY_REQUIRED_CYCLES` distinct
 * cycles hold a legitimate first-try solve. Multiple rows in one cycle count
 * once. Orphaned rows (a `cycleId` with no matching `cycles` row) never credit.
 * Monotonic — adding rows can only add credits, never remove them.
 */
export function masteryOf(
  puzzleId: string,
  attempts: readonly PuzzleAttemptRow[],
  cycles: readonly TrainingCycleRow[],
): boolean {
  const credited = legitimateCycleIdsByPuzzle(attempts, knownCycleIdsOf(cycles)).get(puzzleId);
  return (credited?.size ?? 0) >= MASTERY_REQUIRED_CYCLES;
}

/**
 * The set of puzzle ids mastered across `attempts` (all puzzles, one pass),
 * counting only cycles present in `cycles`. An empty set when nothing is
 * mastered; deterministic and input-non-mutating.
 */
export function masteredPuzzleIds(
  attempts: readonly PuzzleAttemptRow[],
  cycles: readonly TrainingCycleRow[],
): ReadonlySet<string> {
  const mastered = new Set<string>();
  for (const [puzzleId, credited] of legitimateCycleIdsByPuzzle(
    attempts,
    knownCycleIdsOf(cycles),
  )) {
    if (credited.size >= MASTERY_REQUIRED_CYCLES) {
      mastered.add(puzzleId);
    }
  }
  return mastered;
}
