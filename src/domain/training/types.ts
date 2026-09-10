/**
 * Feature 012 — puzzle-training domain types (pure).
 *
 * The shared vocabulary of the solving experience over an immutable
 * Feature-011 `PuzzleRow`: the presentation outcome vocabulary, hint-level
 * configuration, the host-supplied per-puzzle session context, and the
 * immutable `PuzzleAttemptRow` written once per presentation (schema v9).
 * Feature 013 consumes these rows for its cycle lifecycle and derives every
 * cycle aggregate from them; Feature 012 never computes aggregates.
 */

import type { PuzzleOrigin } from '@/domain/puzzle/types';

/**
 * The four progressive hint levels of PRODUCT §10 (the authoritative
 * definition). Hints beyond level 4 are out of scope for V1.
 */
export type HintLevel = 1 | 2 | 3 | 4;

/**
 * Result of one puzzle presentation on the attempt row
 * (`domain/tactical-training.md`).
 *
 * - `solvedFirstTry` — solved on the first attempt without any hint, wrong
 *   move or restart;
 * - `solvedWithHelp` — solved using a hint and/or after a restart (with no
 *   wrong move);
 * - `failed` — gave up / revealed the solution;
 * - `skipped` — left without solving (the result shows only on an explicit
 *   skip; never in any accuracy denominator).
 *
 * Discarding a presentation mid-session writes **no** row and therefore has no
 * result value here.
 */
export type TrainingResult = 'solvedFirstTry' | 'solvedWithHelp' | 'failed' | 'skipped';

/**
 * Host-supplied per-set hint configuration (hint-level availability and the
 * first-hint threshold, from `domain/tactical-training.md`). Pure parameters —
 * the domain never reaches for a hidden default.
 *
 * - `enabledLevels` — which of the four hint levels the set enables;
 * - `firstHintLevel` — the level the first hint press reveals; presses then
 *   ascend through the enabled levels at or above it.
 */
export interface SolveHintConfig {
  readonly enabledLevels: readonly HintLevel[];
  readonly firstHintLevel: HintLevel;
}

/**
 * Host-supplied, per-puzzle session context (spec "Solving-session model").
 *
 * The puzzle itself is identified by its row (`puzzleIdOf` on the row's
 * provenance); this context supplies the set/cycle/presentation coordinates of
 * the presentation. `presentationIndex` is 1-based and is incremented by the
 * host whenever a retry pass re-presents the same puzzle within the cycle — a
 * re-presentation is a **new** row, never an overwrite.
 */
export interface SessionPuzzleContext {
  readonly trainingSetId: string;
  readonly cycleId: string;
  readonly presentationIndex: number;
}

/**
 * The presentation counters recorded on an attempt row. `wrongMoveCount` is
 * the domain's "number of attempts (wrong moves / retries within this puzzle)"
 * per `domain/tactical-training.md` (plan R-5); `hintCount`/`highestHintLevel`
 * record hint *use* only — hint content is never persisted (spec Hints);
 * `restartCount` records presentation-scoped restarts and disqualifies a clean
 * first-try solve (a restart resets the clean line). It is optional so
 * pre-restart callers/fixtures stay valid; an absent value reads as `0`.
 */
export interface PresentationCounters {
  readonly wrongMoveCount: number;
  readonly hintCount: number;
  readonly highestHintLevel: HintLevel | null;
  readonly restartCount?: number;
}

/**
 * One immutable puzzle attempt: a single `PuzzleRow` presentation in a cycle.
 *
 * Written exactly once at a definite presentation outcome (spec "Data
 * requirements"). Natural key `[cycleId, puzzleId, presentationIndex]` — the
 * same puzzle re-presented within a cycle (retry-failed `immediate` /
 * `endOfCycle`) produces an additional row with an incremented
 * `presentationIndex`, never an overwrite, and a row is never updated once
 * written. `puzzleGeneratorVersion` and `origin` are copied from the puzzle at
 * write time so the row stays interpretable after the generator advances
 * (ARCHITECTURE §9); a pre-v2 row with absent `origin` normalizes to
 * `'tactical'`. All fields are `readonly`.
 */
export interface PuzzleAttemptRow {
  /** Canonical puzzle id (`puzzleIdOf(sourceGameId, sourcePly)`). */
  readonly puzzleId: string;
  readonly trainingSetId: string;
  readonly cycleId: string;
  /** 1-based index of this presentation within the cycle (host-owned). */
  readonly presentationIndex: number;
  /** Presentation start, Unix epoch millis (wall clock, R-9). */
  readonly startedAt: number;
  /** Presentation end, Unix epoch millis. */
  readonly endedAt: number;
  readonly result: TrainingResult;
  /** Wall-clock solving time in millis (`endedAt - startedAt`, clamped ≥ 0). */
  readonly solvingTimeMs: number;
  /** The domain's "number of attempts" — wrong moves within this presentation. */
  readonly wrongMoveCount: number;
  readonly hintCount: number;
  /** Highest hint level reached this presentation, or `null` when none used. */
  readonly highestHintLevel: HintLevel | null;
  /** Presentation restarts; `0` on new rows (absent on legacy rows → `0`). */
  readonly restartCount: number;
  /** True when the presentation ended solved (`solvedFirstTry`/`solvedWithHelp`). */
  readonly solved: boolean;
  /** Copied from the puzzle at write time (ARCHITECTURE §9). */
  readonly puzzleGeneratorVersion: number;
  /** Copied from the puzzle at write time; absent pre-v2 rows → `'tactical'`. */
  readonly origin: PuzzleOrigin;
}

/**
 * What a presentation outcome hands back to the host (spec "Solving-session
 * model"): the written attempt summary plus the immutable attempt row that
 * carries it. A presentation discarded on session leave has **no** outcome —
 * `null`-equivalent — and writes no row.
 */
export interface PresentationOutcome {
  readonly result: TrainingResult;
  readonly solvingTimeMs: number;
  readonly wrongMoveCount: number;
  readonly hintCount: number;
  readonly highestHintLevel: HintLevel | null;
  readonly restartCount: number;
  readonly solved: boolean;
  /** The immutable attempt row written for this presentation outcome. */
  readonly attemptRow: PuzzleAttemptRow;
}
