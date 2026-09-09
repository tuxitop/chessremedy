/**
 * Puzzle-attempt recorder (Feature 012, Stage C).
 *
 * A thin, engine-free application service over the `PuzzleAttemptsRepository`
 * that turns a presentation outcome into its single immutable attempt row. It
 * is the write path the solving UI (Stage D) and the Feature-013 host drive at
 * a definite outcome, and it sits between the pure Stage-A domain
 * (`buildAttemptRow`) and the schema-v9 repository.
 *
 * Persistence semantics (spec "Data requirements", plan R-3):
 *
 * - **Exactly one row per presentation outcome.** `record` builds the
 *   immutable row via the domain `buildAttemptRow` and hands it to the
 *   repository's first-write-wins `addAttempt` on the natural key
 *   `[cycleId, puzzleId, presentationIndex]`.
 * - **First write wins; retries are idempotent.** `'added'` → `'written'`;
 *   `'already-present'` → `'already-written'` — the outcome a prior ambiguous
 *   write landed is detected, never double-written or mutated, and the session
 *   may advance. `'already-present'` is **not** an error.
 * - **Genuine write failures throw.** A persistence failure is rethrown as a
 *   `PuzzleAttemptWriteError` (the underlying repository failure is preserved
 *   as the `cause`) — never silently dropped. The caller (UI/host) keeps the
 *   outcome screen with an inline error and a retry, exactly per the plan.
 *
 * The service computes nothing beyond the row: no cycle aggregates, no
 * scheduling, no engine, no network. A row whose `endedAt` the caller omits is
 * stamped by the recorder's own clock (injectable `now`, plan R-9) so tests
 * stay deterministic.
 */

import { buildAttemptRow } from '@/domain/training/outcome';
import type { BuildAttemptRowInput } from '@/domain/training/outcome';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';

/**
 * Inputs to `PuzzleAttemptRecorder.record` — the presentation-outcome snapshot
 * the recorder persists. `endedAt` is optional: when omitted the recorder's
 * injected clock (`now`, default `Date.now`) stamps the row end.
 */
export type RecordAttemptInput = Omit<BuildAttemptRowInput, 'endedAt'> & {
  readonly endedAt?: number;
};

/**
 * Structural recorder contract — the seam the solving UI (Stage D) and the
 * Feature-013 host depend on (a stub or fake implements this type in tests).
 */
export interface PuzzleAttemptRecorderLike {
  /**
   * Persist one attempt row for a presentation outcome — exactly once per
   * outcome, first-write-wins on the natural key.
   *
   * @returns `{ status: 'written' }` when the row was persisted;
   *   `{ status: 'already-written' }` when the natural key already holds an
   *   identical row (an idempotent retry of an ambiguous prior write — the
   *   session may advance). A genuine write failure is **thrown** as a
   *   `PuzzleAttemptWriteError` — never silently dropped; the caller keeps the
   *   outcome visible with an inline error and a retry.
   * @throws {PuzzleAttemptWriteError} when the underlying `addAttempt` write
   *   fails.
   */
  record(input: RecordAttemptInput): Promise<AttemptWriteResult>;
}

/**
 * Result of a successful `record`: the persisted (or already-present) attempt
 * row. Both statuses carry the immutable row written under the natural key —
 * `'already-written'` means the row was left byte-identical by the
 * first-write-wins repository, not overwritten or mutated.
 */
export type AttemptWriteResult = {
  readonly status: 'written' | 'already-written';
  readonly attemptRow: PuzzleAttemptRow;
};

/**
 * Raised when a genuine attempt-row write fails (spec "Error cases": a write
 * failure is surfaced to the caller, never silently dropped). Carries the
 * immutable row the recorder built (for an inline error/retry UI) and the
 * underlying repository failure as `cause`.
 */
export class PuzzleAttemptWriteError extends Error {
  /** The immutable row whose persistence failed. */
  readonly attemptRow: PuzzleAttemptRow;
  /** The underlying repository failure. */
  override readonly cause: unknown;

  constructor(attemptRow: PuzzleAttemptRow, cause: unknown) {
    super(
      `Failed to persist puzzle attempt for ${attemptRow.puzzleId} ` +
        `(cycle ${attemptRow.cycleId}, presentation ${attemptRow.presentationIndex}).`,
    );
    this.name = 'PuzzleAttemptWriteError';
    this.attemptRow = attemptRow;
    this.cause = cause;
  }
}

/** Constructor options for the repository-backed recorder. */
export interface PuzzleAttemptRecorderOptions {
  /** The schema-v9 attempts repository (first-write-wins `addAttempt`). */
  readonly attempts: PuzzleAttemptsRepository;
  /**
   * Wall clock for a row whose `endedAt` the caller omits (Unix epoch millis);
   * defaults to `Date.now`. Injectable for deterministic tests (plan R-9).
   */
  readonly now?: () => number;
}

/**
 * The default `PuzzleAttemptRecorder`: persists outcome rows through the
 * `PuzzleAttemptsRepository`, mapping `'added'` → `'written'` and
 * `'already-present'` → `'already-written'`, and rethrowing a genuine write
 * failure as a `PuzzleAttemptWriteError` (never silently dropped).
 */
export class PuzzleAttemptRecorder implements PuzzleAttemptRecorderLike {
  private readonly attempts: PuzzleAttemptsRepository;
  private readonly now: () => number;

  constructor(options: PuzzleAttemptRecorderOptions) {
    this.attempts = options.attempts;
    this.now = options.now ?? (() => Date.now());
  }

  async record(input: RecordAttemptInput): Promise<AttemptWriteResult> {
    const row = buildAttemptRow({ ...input, endedAt: input.endedAt ?? this.now() });
    try {
      const added = await this.attempts.addAttempt(row);
      return added === 'added'
        ? { status: 'written', attemptRow: row }
        : { status: 'already-written', attemptRow: row };
    } catch (error) {
      // A genuine write failure is rethrown with context (never silently
      // dropped): the caller keeps the outcome screen with an inline error and
      // a retry, exactly per the plan.
      throw new PuzzleAttemptWriteError(row, error);
    }
  }
}
