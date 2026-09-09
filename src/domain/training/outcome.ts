/**
 * Feature 012 — outcome derivation and attempt-row building (domain, pure).
 *
 * Maps the end of a presentation to the spec's Outcomes table: a clean solve
 * records `solvedFirstTry`, a solve after any hint and/or wrong move records
 * `solvedWithHelp`, give-up/show-solution records `failed`, and an explicit
 * skip records `skipped`. Discarding a presentation mid-session writes nothing
 * — there is no trigger for it, and no result value (spec "Entering and
 * leaving a presentation").
 *
 * `buildAttemptRow` is the single immutable-row constructor: it computes the
 * timing/solved/highest-level fields and copies the puzzle's
 * `puzzleGeneratorVersion` and normalized `origin` (absent on a pre-v2 row =
 * `'tactical'`) so rows stay interpretable after the generator advances
 * (ARCHITECTURE §9, plan R-8). Hint *content* is never persisted — only the
 * counters.
 */

import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type {
  PresentationCounters,
  PresentationOutcome,
  PuzzleAttemptRow,
  SessionPuzzleContext,
} from './types';

/**
 * The event that ends a presentation with a definite outcome.
 *
 * `discard` is deliberately absent: leaving mid-presentation writes no row and
 * calls none of these functions.
 */
export type OutcomeTrigger = 'solved' | 'gaveUp' | 'skip';

/**
 * Result for an outcome trigger given the presentation's counters, per the
 * spec Outcomes table:
 *
 * - `solved` with no hint and no wrong move → `solvedFirstTry`;
 * - `solved` after any hint and/or any wrong move → `solvedWithHelp`;
 * - `gaveUp` (revealed the solution) → `failed`;
 * - `skip` → `skipped`.
 */
export function deriveResult(
  trigger: OutcomeTrigger,
  counters: PresentationCounters,
): PuzzleAttemptRow['result'] {
  if (trigger === 'solved') {
    return counters.hintCount === 0 && counters.wrongMoveCount === 0
      ? 'solvedFirstTry'
      : 'solvedWithHelp';
  }
  return trigger === 'gaveUp' ? 'failed' : 'skipped';
}

/** Inputs to `buildAttemptRow`. */
export interface BuildAttemptRowInput {
  /** The immutable puzzle row being presented (never modified). */
  readonly row: PuzzleRow;
  /** Host-supplied set/cycle/presentation coordinates. */
  readonly context: SessionPuzzleContext;
  /** How the presentation ended (`solved`/`gaveUp`/`skip`). */
  readonly trigger: OutcomeTrigger;
  /** The presentation's wrong-move/hint counters. */
  readonly counters: PresentationCounters;
  /** Presentation start, Unix epoch millis (the state's `startedAt`). */
  readonly startedAt: number;
  /** Presentation end, Unix epoch millis (wall clock at the outcome). */
  readonly endedAt: number;
}

/**
 * Build the immutable attempt row for a presentation outcome.
 *
 * `solvingTimeMs` is wall-clock `endedAt - startedAt` clamped at 0 (a
 * deterministic guard against clock skew); `solved` is true exactly for a
 * `solved` trigger; `puzzleId` is the canonical `puzzleIdOf(row)`; and the
 * row's `puzzleGeneratorVersion` and `origin` (normalized) are copied at write
 * time. A corrected outcome is never a mutation of this row — it is a new
 * presentation with an incremented `presentationIndex`.
 */
export function buildAttemptRow(input: BuildAttemptRowInput): PuzzleAttemptRow {
  const { row, context, trigger, counters, startedAt, endedAt } = input;
  return {
    puzzleId: puzzleIdOf(row.sourceGameId, row.sourcePly),
    trainingSetId: context.trainingSetId,
    cycleId: context.cycleId,
    presentationIndex: context.presentationIndex,
    startedAt,
    endedAt,
    result: deriveResult(trigger, counters),
    solvingTimeMs: Math.max(0, endedAt - startedAt),
    wrongMoveCount: counters.wrongMoveCount,
    hintCount: counters.hintCount,
    highestHintLevel: counters.highestHintLevel,
    solved: trigger === 'solved',
    puzzleGeneratorVersion: row.puzzleGeneratorVersion,
    origin: row.origin ?? 'tactical',
  };
}

/**
 * Wrap a built attempt row in the host-facing `PresentationOutcome`: the
 * written summary fields plus the row that carries them.
 */
export function presentationOutcomeOf(attemptRow: PuzzleAttemptRow): PresentationOutcome {
  return {
    result: attemptRow.result,
    solvingTimeMs: attemptRow.solvingTimeMs,
    wrongMoveCount: attemptRow.wrongMoveCount,
    hintCount: attemptRow.hintCount,
    highestHintLevel: attemptRow.highestHintLevel,
    solved: attemptRow.solved,
    attemptRow,
  };
}
