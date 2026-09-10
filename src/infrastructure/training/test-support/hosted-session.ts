/**
 * Feature 012 — hosted-session harness (test-support).
 *
 * A minimal, **test-only** host that stands in for the Feature-013 cycle host
 * while that feature is unimplemented: it drives whole presentations
 * end-to-end over an ordered queue of fixture `PuzzleRow`s through the pure
 * Stage-A solving engine and records each outcome via the Stage-C
 * `PuzzleAttemptRecorder`. Everything is deterministic and in-memory — the
 * caller injects an in-memory `PuzzleAttemptsRepository` fake, so no
 * IndexedDB/engine/network is touched — and Feature-013 later replaces this
 * harness with its real host without touching Feature-012's domain/service.
 *
 * Host contract mirrored here (spec "Solving-session model", plan Stage C):
 *
 * - **Ordered queue.** `rows` is the cycle's presentation order
 *   (`next-unanswered in cycle order`): `beginNext` yields the front pending
 *   puzzle, a solved/skipped puzzle leaves the queue (answered), and a failed
 *   puzzle is re-presented per the configured `retryFailed` mode.
 * - **Per-puzzle session context.** Each presentation gets a
 *   `SessionPuzzleContext` whose `presentationIndex` starts at 1 and is
 *   incremented whenever the puzzle is re-presented after a **durable** failed
 *   write — so a retry-pass re-presentation writes an additional row, never an
 *   overwrite. A discarded presentation (no durable row) leaves the puzzle
 *   unanswered at the front with the same index.
 * - **Config snapshot.** The `config` given at construction is the
 *   `SolveHintConfig` every presentation's hints resolve against.
 * - **Discard-on-exit = skip the write.** `discard()` mid-solving ends the
 *   presentation with no attempt row; the puzzle stays unanswered.
 * - **Write-failure containment.** The recorder throws on a genuine write
 *   failure (plan R-3). The harness catches that throw so the session is never
 *   corrupted: the outcome stays visible and the presentation is `retryable` —
 *   the session never advances past an unwritten row. `retryWrite()` retries
 *   the same frozen snapshot (idempotent — an ambiguous earlier write that
 *   actually landed resolves `'already-written'`); a retry that fails again
 *   **throws to the host**, and `discard()`/confirm-discard abandons the row.
 *
 * The harness only *counts* rows (`recordedAttemptCount`); it computes no
 * cycle aggregates, matching Feature-012's boundary (AC #9).
 */

import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import {
  applyMove,
  beginPresentation,
  buildAttemptRow,
  revealNextHint,
  restartPresentation,
} from '@/domain/training';
import type { HintLevel, SolveHintConfig } from '@/domain/training/types';
import type { PresentationMoveResult, PresentationState } from '@/domain/training';
import type { OutcomeTrigger } from '@/domain/training';
import type {
  PresentationCounters,
  PresentationOutcome,
  PuzzleAttemptRow,
  SessionPuzzleContext,
} from '@/domain/training/types';
import { presentationOutcomeOf } from '@/domain/training';
import { DEFAULT_TRAINING_SET_ID } from '@/domain/training/test-support';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import {
  PuzzleAttemptRecorder,
  type AttemptWriteResult,
  type PuzzleAttemptRecorderLike,
  type RecordAttemptInput,
} from '../attempts-service';

/**
 * How a durable `failed` outcome re-presents the puzzle:
 *
 * - `'none'` — the puzzle is answered by its failed presentation (single pass);
 * - `'immediate'` — re-present it immediately (front of the queue);
 * - `'endOfCycle'` — re-present it after the rest of the queue.
 *
 * (The two retry modes mirror Feature-013's `retry-failed` behaviours; `'none'`
 * is the harness's single-pass convenience. A re-presentation always writes an
 * **additional** row with an incremented `presentationIndex`.)
 */
export type HostedRetryFailedMode = 'none' | 'immediate' | 'endOfCycle';

/** Constructor options for `HostedSession`. */
export interface HostedSessionOptions {
  /** Cycle identity the session records its attempt rows under. */
  readonly cycleId: string;
  /** The cycle's ordered queue of puzzles (presentation order). */
  readonly rows: readonly PuzzleRow[];
  /**
   * The set's `SolveHintConfig` snapshot every presentation's hints resolve
   * against (host-supplied; never reached for by the domain).
   */
  readonly config: SolveHintConfig;
  /** Attempt persistence (inject an in-memory fake in tests — no IndexedDB). */
  readonly attempts: PuzzleAttemptsRepository;
  /** Training-set identity recorded on each attempt row. */
  readonly trainingSetId?: string;
  /** How a durable `failed` outcome re-presents its puzzle. Default `'endOfCycle'`. */
  readonly retryFailed?: HostedRetryFailedMode;
  /** Wall clock (Unix epoch millis); defaults to `Date.now`. Injectable for deterministic tests. */
  readonly now?: () => number;
}

/** One begun presentation, in begin order (the harness's observation seam). */
export interface HostedPresentationSummary {
  /** Canonical puzzle id (`puzzleIdOf(sourceGameId, sourcePly)`). */
  readonly puzzleId: string;
  /** The context the presentation was begun under. */
  readonly context: SessionPuzzleContext;
}

/** Result of `beginNext`. */
export type HostedBeginResult =
  | { readonly ok: true; readonly presentation: HostedPresentation }
  | { readonly ok: false; readonly message: string };

/**
 * A frozen presentation outcome plus its write status: present on every
 * definite outcome (solve/give-up/skip). The outcome stays visible while the
 * presentation is `retryable` — `write` is then `null` and `error` carries the
 * recorder's thrown failure until `retryWrite` succeeds (or `discard()`
 * confirms the drop).
 */
export interface HostedFinalization {
  /** The frozen outcome summary (derived from the immutable row). */
  readonly outcome: PresentationOutcome;
  /** The durable write result once recorded; `null` while `retryable`. */
  readonly write: AttemptWriteResult | null;
  /** The recorder's write failure while `retryable`; absent once written. */
  readonly error?: unknown;
}

/** Result of `HostedPresentation.play`. */
export type HostedPlayResult =
  | { readonly kind: 'move'; readonly move: PresentationMoveResult }
  | {
      readonly kind: 'solved';
      readonly move: PresentationMoveResult;
      readonly finalization: HostedFinalization;
    }
  | { readonly kind: 'not-solving'; readonly message: string };

/** Result of `HostedPresentation.giveUp` / `skip` / `retryWrite`. */
export type HostedFinalizeResult =
  | { readonly ok: true; readonly finalization: HostedFinalization }
  | { readonly ok: false; readonly reason: 'not-solving'; readonly message: string };

/** Result of `HostedPresentation.hint`. */
export type HostedHintResult =
  | { readonly ok: true; readonly level: HintLevel; readonly state: PresentationState }
  | {
      readonly ok: false;
      readonly reason: 'first-move-solved' | 'no-further-level' | 'not-solving';
      readonly state: PresentationState;
    };

/** Result of `HostedPresentation.restart`. */
export type HostedRestartResult =
  | { readonly ok: true; readonly state: PresentationState }
  | { readonly ok: false; readonly reason: 'not-solving'; readonly state: PresentationState };

/** Lifecycle of one hosted presentation (transient, never persisted). */
export type HostedPresentationStatus =
  /** Solving: moves/hints/restart/give-up/skip/discard are available. */
  | 'solving'
  /**
   * A definite outcome exists whose write failed: the outcome stays visible and
   * only `retryWrite` / `discard` are available; the session does not advance.
   */
  | 'retryable'
  /** Ended: the outcome was written durably or the presentation was discarded. */
  | 'ended';

interface QueueEntry {
  readonly row: PuzzleRow;
  /** The 1-based index the puzzle's NEXT presentation records under. */
  nextPresentationIndex: number;
}

interface PresentationServices {
  readonly context: SessionPuzzleContext;
  readonly config: SolveHintConfig;
  readonly row: PuzzleRow;
  readonly state: PresentationState;
  readonly recorder: PuzzleAttemptRecorderLike;
  readonly now: () => number;
  readonly onDurableEnd: (attemptRow: PuzzleAttemptRow) => void;
  readonly onDiscardEnd: () => void;
}

/**
 * One presentation under the hosted session: wraps the pure Stage-A solver
 * state with the host-supplied context/config and performs the outcome write
 * through the recorder at a definite outcome (a move that solves, a give-up, a
 * skip). See the module header for the full contract.
 */
export class HostedPresentation {
  /** The immutable puzzle row being presented. */
  readonly row: PuzzleRow;
  /** Host-supplied set/cycle/presentation coordinates of this presentation. */
  readonly context: SessionPuzzleContext;
  /** The session's `SolveHintConfig` snapshot (hints resolve against it). */
  readonly config: SolveHintConfig;

  private readonly services: PresentationServices;
  private state: PresentationState;
  private status: HostedPresentationStatus;
  private finalization: HostedFinalization | null = null;
  /** The frozen record input of a definite outcome (reused by `retryWrite`). */
  private frozenInput: RecordAttemptInput | null = null;

  constructor(services: PresentationServices) {
    this.services = services;
    this.row = services.row;
    this.context = services.context;
    this.config = services.config;
    this.state = services.state;
    this.status = 'solving';
  }

  /** The presentation's lifecycle status. */
  get statusView(): HostedPresentationStatus {
    return this.status;
  }

  /** The current solving state (played line, counters, hints). */
  get solveState(): PresentationState {
    return this.state;
  }

  /**
   * The frozen outcome + last write result once a definite outcome exists, or
   * `null` while solving. On a `retryable` presentation the outcome is visible
   * here while the write is pending.
   */
  get outcome(): HostedFinalization | null {
    return this.finalization;
  }

  /**
   * Evaluate one canonical-UCI move at the current decision point (Stage-A
   * `applyMove`). A legal move that completes the solution is a definite
   * `'solved'` outcome: the attempt is recorded (trigger `'solved'`) before
   * this resolves — the write result is carried in `finalization`. Returns
   * `'not-solving'` once the presentation is `retryable`/`ended`.
   */
  async play(uci: string): Promise<HostedPlayResult> {
    if (this.status !== 'solving') {
      return { kind: 'not-solving', message: 'This presentation is not solving anymore.' };
    }
    const result = applyMove(this.state, uci);
    this.state = result.state;
    if (result.kind === 'accepted' && result.solved) {
      const finalization = await this.finalize('solved');
      return { kind: 'solved', move: result, finalization };
    }
    return { kind: 'move', move: result };
  }

  /**
   * Reveal the next hint level against the session's config snapshot
   * (Stage-A `revealNextHint`); using a hint never fails the puzzle.
   */
  hint(): HostedHintResult {
    if (this.status !== 'solving') {
      return { ok: false, reason: 'not-solving', state: this.state };
    }
    const result = revealNextHint(this.state, this.config);
    if (result.ok) {
      this.state = result.state;
      return { ok: true, level: result.level, state: result.state };
    }
    return { ok: false, reason: result.reason, state: result.state };
  }

  /**
   * Restart the presentation (clears the played line and revealed hint content;
   * keeps counters and clock — Stage-A `restartPresentation`). Solving only.
   */
  restart(): HostedRestartResult {
    if (this.status !== 'solving') {
      return { ok: false, reason: 'not-solving', state: this.state };
    }
    this.state = restartPresentation(this.state);
    return { ok: true, state: this.state };
  }

  /** Give up / reveal the solution: a definite `failed` outcome is recorded. */
  async giveUp(): Promise<HostedFinalizeResult> {
    return this.finalizeWith('gaveUp');
  }

  /** Skip the puzzle: a definite `skipped` outcome is recorded. */
  async skip(): Promise<HostedFinalizeResult> {
    return this.finalizeWith('skip');
  }

  /**
   * Retry the frozen outcome's write after a recorder write failure threw
   * (idempotent — an ambiguous first write that landed resolves to
   * `'already-written'`). Available only while `retryable`; a retry that fails
   * again **throws to the host** (the outcome stays visible and `retryable`).
   */
  async retryWrite(): Promise<HostedFinalizeResult> {
    if (this.status !== 'retryable' || this.frozenInput === null || this.finalization === null) {
      return {
        ok: false,
        reason: 'not-solving',
        message: 'There is no failed outcome write to retry.',
      };
    }
    const write = await this.services.recorder.record(this.frozenInput);
    this.finalization = {
      outcome: presentationOutcomeOf(write.attemptRow),
      write,
    };
    this.status = 'ended';
    this.services.onDurableEnd(write.attemptRow);
    return { ok: true, finalization: this.finalization };
  }

  /**
   * End the presentation without a durable row: mid-solving this discards the
   * outcome (the puzzle stays unanswered); while `retryable` it is the explicit
   * confirm-discard of an unwritten outcome.
   */
  discard(): void {
    if (this.status === 'ended') {
      return;
    }
    this.status = 'ended';
    this.services.onDiscardEnd();
  }

  private async finalizeWith(trigger: OutcomeTrigger): Promise<HostedFinalizeResult> {
    if (this.status !== 'solving') {
      return {
        ok: false,
        reason: 'not-solving',
        message: 'This presentation is not solving anymore.',
      };
    }
    const finalization = await this.finalize(trigger);
    return { ok: true, finalization };
  }

  /**
   * Freeze the outcome snapshot and attempt its write. A recorder write failure
   * is caught so the session is never corrupted: the outcome stays visible and
   * the presentation turns `retryable` (never advanced, never silently
   * dropped); `retryWrite` re-runs the same frozen snapshot.
   */
  private async finalize(trigger: OutcomeTrigger): Promise<HostedFinalization> {
    const counters: PresentationCounters = {
      wrongMoveCount: this.state.wrongMoveCount,
      hintCount: this.state.hintCount,
      highestHintLevel: this.state.highestHintLevel,
      restartCount: this.state.restartCount,
    };
    const endedAt = this.services.now();
    this.frozenInput = {
      row: this.row,
      context: this.context,
      trigger,
      counters,
      startedAt: this.state.startedAt,
      endedAt,
    };
    // The canonical row (identical to what the recorder persists) makes the
    // outcome visible even while the write is pending/retryable.
    const attemptRow = buildAttemptRow({
      row: this.row,
      context: this.context,
      trigger,
      counters,
      startedAt: this.state.startedAt,
      endedAt,
    });
    const visible: HostedFinalization = { outcome: presentationOutcomeOf(attemptRow), write: null };
    try {
      const write = await this.services.recorder.record(this.frozenInput);
      this.finalization = { outcome: presentationOutcomeOf(write.attemptRow), write };
      this.status = 'ended';
      this.services.onDurableEnd(write.attemptRow);
    } catch (error) {
      this.finalization = { ...visible, error };
      this.status = 'retryable';
    }
    return this.finalization;
  }
}

/**
 * The hosted-session harness: a deterministic, in-memory stand-in for the
 * Feature-013 cycle host over an ordered queue of puzzle rows (module header).
 */
export class HostedSession {
  private readonly cycleIdValue: string;
  private readonly trainingSetIdValue: string;
  private readonly configValue: SolveHintConfig;
  private readonly retryFailed: HostedRetryFailedMode;
  private readonly now: () => number;
  private readonly attempts: PuzzleAttemptsRepository;
  private readonly recorder: PuzzleAttemptRecorderLike;
  private readonly queue: QueueEntry[];
  private readonly presentedLog: HostedPresentationSummary[] = [];
  private active: { readonly presentation: HostedPresentation; readonly entry: QueueEntry } | null =
    null;

  constructor(options: HostedSessionOptions) {
    this.cycleIdValue = options.cycleId;
    this.trainingSetIdValue = options.trainingSetId ?? DEFAULT_TRAINING_SET_ID;
    this.configValue = options.config;
    this.retryFailed = options.retryFailed ?? 'endOfCycle';
    this.now = options.now ?? (() => Date.now());
    this.attempts = options.attempts;
    this.recorder = new PuzzleAttemptRecorder({ attempts: options.attempts, now: this.now });
    this.queue = options.rows.map((row) => ({ row, nextPresentationIndex: 1 }));
  }

  /** The cycle identity attempt rows are recorded under. */
  get cycleId(): string {
    return this.cycleIdValue;
  }

  /** The training-set identity recorded on attempt rows. */
  get trainingSetId(): string {
    return this.trainingSetIdValue;
  }

  /** The session's config snapshot. */
  get config(): SolveHintConfig {
    return this.configValue;
  }

  /** Puzzles still to be presented (answered/discarded ones are not counted). */
  get remaining(): number {
    return this.queue.length;
  }

  /** Every begun presentation, in begin order (observation only). */
  get presented(): readonly HostedPresentationSummary[] {
    return this.presentedLog;
  }

  /** The presentation in progress, if any (blocks `beginNext` until closed). */
  get activePresentation(): HostedPresentation | null {
    return this.active?.presentation ?? null;
  }

  /**
   * Begin the next presentation: the front pending puzzle of the ordered queue.
   * Returns `ok: false` when no puzzle remains or while a presentation is
   * active (an unwritten outcome must be written or explicitly discarded
   * first — the session never advances past an unwritten row).
   */
  beginNext(): HostedBeginResult {
    if (this.active !== null) {
      return {
        ok: false,
        message: 'A presentation is in progress; end, retry-write or discard it first.',
      };
    }
    while (this.queue.length > 0) {
      const entry = this.queue.shift() as QueueEntry;
      const begun = beginPresentation(entry.row, this.now());
      if (!begun.ok) {
        // A row that fails to load is a pipeline defect: drop it without an
        // attempt (like a discard) and move to the next puzzle — the session
        // never crashes (spec Error cases).
        continue;
      }
      const context: SessionPuzzleContext = {
        trainingSetId: this.trainingSetIdValue,
        cycleId: this.cycleIdValue,
        presentationIndex: entry.nextPresentationIndex,
      };
      const presentation = new HostedPresentation({
        context,
        config: this.configValue,
        row: entry.row,
        state: begun.state,
        recorder: this.recorder,
        now: this.now,
        onDurableEnd: (attemptRow) => this.settleDurable(attemptRow),
        onDiscardEnd: () => this.requeueActive(),
      });
      this.active = { presentation, entry };
      this.presentedLog.push({
        puzzleId: puzzleIdOf(entry.row.sourceGameId, entry.row.sourcePly),
        context,
      });
      return { ok: true, presentation };
    }
    return { ok: false, message: 'The session queue has no puzzles left.' };
  }

  /**
   * Count the session's durable attempt rows (this cycle). The harness counts
   * rows only — it derives no accuracy/time aggregates (Feature-012 boundary).
   */
  async recordedAttemptCount(): Promise<number> {
    return (await this.attempts.listForCycle(this.cycleIdValue)).length;
  }

  /**
   * Settle a durable presentation end: retire solved/skipped puzzles and, for a
   * `failed` outcome, re-present the puzzle per the retry mode with an
   * incremented `presentationIndex` (an additional row, never an overwrite).
   */
  private settleDurable(attemptRow: PuzzleAttemptRow): void {
    const entry = this.active?.entry;
    this.active = null;
    if (entry === undefined) {
      return;
    }
    if (attemptRow.result === 'failed' && this.retryFailed !== 'none') {
      const retry: QueueEntry = {
        row: entry.row,
        nextPresentationIndex: attemptRow.presentationIndex + 1,
      };
      if (this.retryFailed === 'immediate') {
        this.queue.unshift(retry);
      } else {
        this.queue.push(retry);
      }
    }
  }

  /** Settle a discard end: the puzzle stays unanswered at the queue front. */
  private requeueActive(): void {
    const entry = this.active?.entry;
    this.active = null;
    if (entry !== undefined) {
      this.queue.unshift(entry);
    }
  }
}
