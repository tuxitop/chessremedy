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
 * a missing/blank `cycleId` are ignored.
 */

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
 * blank cycle id) are skipped.
 */
function legitimateCycleIdsByPuzzle(
  attempts: readonly PuzzleAttemptRow[],
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
    let cycles = byPuzzle.get(puzzleId);
    if (cycles === undefined) {
      cycles = new Set<string>();
      byPuzzle.set(puzzleId, cycles);
    }
    cycles.add(cycleId);
  }
  return byPuzzle;
}

/**
 * Whether `puzzleId` is mastered: at least `MASTERY_REQUIRED_CYCLES` distinct
 * cycles hold a legitimate first-try solve. Multiple rows in one cycle count
 * once. Monotonic — adding rows can only add credits, never remove them.
 */
export function masteryOf(puzzleId: string, attempts: readonly PuzzleAttemptRow[]): boolean {
  const cycles = legitimateCycleIdsByPuzzle(attempts).get(puzzleId);
  return (cycles?.size ?? 0) >= MASTERY_REQUIRED_CYCLES;
}

/**
 * The set of puzzle ids mastered across `attempts` (all puzzles, one pass). An
 * empty set when nothing is mastered; deterministic and input-non-mutating.
 */
export function masteredPuzzleIds(attempts: readonly PuzzleAttemptRow[]): ReadonlySet<string> {
  const mastered = new Set<string>();
  for (const [puzzleId, cycles] of legitimateCycleIdsByPuzzle(attempts)) {
    if (cycles.size >= MASTERY_REQUIRED_CYCLES) {
      mastered.add(puzzleId);
    }
  }
  return mastered;
}
