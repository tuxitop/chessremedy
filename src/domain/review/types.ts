/**
 * Feature 020 — individual review-scheduling domain vocabulary (pure).
 *
 * The shared types of the post-V1 review strategy (ADR-035): the FSRS-style
 * `Grade` vocabulary, the serializable `ScheduleState`, the swappable
 * `Scheduler` interface, the per-local-day caps/usage and the review
 * overview/queue read models. No React, Dexie, engine, network or library
 * import lives here; the adapter is the only module that imports `ts-fsrs`.
 */

/**
 * The scheduler's rating vocabulary. `again`/`hard`/`good`/`easy` map to the
 * library's `Rating` (the manual rating is never produced).
 */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

/**
 * Normalized library card state. The library's `New` phase is folded into
 * `learning` (a brand-new puzzle is a learning card with zero steps).
 */
export type SchedulePhase = 'learning' | 'review' | 'relearning';

/**
 * A serializable per-puzzle scheduling state: epoch-millis timestamps and
 * plain numbers only, no `Date` instances, so it can be stored in Dexie and
 * passed across boundaries without conversion leaks.
 */
export interface ScheduleState {
  /** Next due instant, Unix epoch millis. */
  readonly dueAt: number;
  /** Last graded instant, Unix epoch millis; `null` before any grade. */
  readonly lastReviewedAt: number | null;
  /** Normalized library phase. */
  readonly state: SchedulePhase;
  /** Library stability (interval at the target retention). */
  readonly stability: number;
  /** Library difficulty (NOT the ADR-025 puzzle difficulty). */
  readonly difficulty: number;
  /** Library elapsed-days value. */
  readonly elapsedDays: number;
  /** Library scheduled interval in days. */
  readonly scheduledDays: number;
  /** Review repetitions. */
  readonly reps: number;
  /** Lapses (`again` outcomes). */
  readonly lapses: number;
  /** Library learning-step index. */
  readonly learningStep: number;
}

/**
 * The pure, deterministic scheduler seam. The single adapter implements it
 * over `ts-fsrs`; the projection, grade mapping and review UI depend only on
 * this interface, so the algorithm is swappable without a data migration.
 */
export interface Scheduler {
  /** The initial state of an unscheduled puzzle. */
  initialState(now: number): ScheduleState;
  /** The state each grade would produce, for UI hints. */
  preview(state: ScheduleState, now: number): Record<Grade, ScheduleState>;
  /** The state after applying `grade` at `at`. */
  next(state: ScheduleState, grade: Grade, at: number): ScheduleState;
  /** Current recall probability in `[0, 1]`. */
  retrievability(state: ScheduleState, now: number): number;
}

/** The normalized daily caps in force. `0` pauses a category. */
export interface ReviewCaps {
  /** Maximum new-puzzle intake per local day. */
  readonly newCap: number;
  /** Maximum due reviews per local day. */
  readonly reviewCap: number;
}

/** How many puzzles of each category have already been presented today. */
export interface DayUsage {
  readonly newCount: number;
  readonly reviewCount: number;
}

/** Whether a queued puzzle is a due review or new intake. */
export type ReviewQueueKind = 'review' | 'new';

/** One entry in the ordered review-session snapshot. */
export interface ReviewQueueEntry {
  readonly puzzleId: string;
  readonly kind: ReviewQueueKind;
  /** The scheduled due instant for a review, or `null` for new intake. */
  readonly dueAt: number | null;
}

/**
 * The derived review read model the entry card and session setup render.
 * `retention` is `null` when no scheduled puzzle is loaded (never a fabricated
 * `0`); `nextDueAt` is the earliest future due instant, or `null` when nothing
 * is scheduled.
 */
export interface ReviewOverview {
  /** The true due backlog (`dueAt <= now`), before the display cap. */
  readonly dueNow: number;
  /** The new-intake count available under the daily cap. */
  readonly newCount: number;
  /** The ordered session snapshot (due reviews then new intake). */
  readonly queue: readonly ReviewQueueEntry[];
  /** Average retrievability over the bounded loaded set, or `null`. */
  readonly retention: number | null;
  /** Earliest future `dueAt`, or `null` when nothing is scheduled ahead. */
  readonly nextDueAt: number | null;
  /** Gradeable puzzles whose schedule row is missing/stale (pending rebuild). */
  readonly pendingRebuild: number;
  /** The caps in force. */
  readonly caps: ReviewCaps;
  /** Today's cap usage. */
  readonly dayUsage: DayUsage;
}
