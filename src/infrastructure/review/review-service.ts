/**
 * Feature 020 — review-scheduling application service (infrastructure).
 *
 * The engine-free coordination layer over the pure review domain and the
 * persisted rows. It owns:
 *
 * - `overview` — the derived review read model (due/new/retention/next-due)
 *   for the entry card and session setup, from persisted rows only;
 * - `reconcile` — a bounded, resumable pass that drops orphan schedule rows
 *   and rebuilds missing/stale/corrupt ones from the immutable attempt log;
 * - `startSession` — snapshots the due queue into one `REVIEW_SET_ID` cycle
 *   (no `trainingSets` row), abandoning any in-progress review cycle;
 * - `applyOutcome` — maps a definite outcome to a grade and updates the
 *   puzzle's schedule projection (never crashing a session);
 * - `rebuildPuzzle` / `retentionOf`.
 *
 * Every clock/id read is injectable; expected states are typed results, never
 * throws. No engine, network or React import.
 */

import {
  REVIEW_CYCLE_CONFIG,
  REVIEW_SET_ID,
  SCHEDULE_REBUILD_BATCH,
  applyGrade,
  dayUsageOf,
  dueQueue,
  gradeForAttempt,
  isScheduleCorrupt,
  isScheduleStale,
  normalizeCaps,
  scheduleFromHistory,
  scheduleRowFrom,
  type DayUsage,
  type PuzzleScheduleRow,
  type ReviewCaps,
  type ReviewOverview,
  type ReviewQueueEntry,
  type ScheduleState,
  type Scheduler,
} from '@/domain/review';
import {
  CYCLE_METRICS_VERSION,
  derivePool,
  isSameLocalCalendarDay,
  masteredPuzzleIds,
  nextCycleNumber,
  validateCycleConfig,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
} from '@/domain/training';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { ReviewSchedulesRepository } from '@/infrastructure/db/review-schedules-repository';
import type { SettingsRepository } from '@/infrastructure/db/settings-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { SETTINGS_KEYS } from '@/config/app-config';

/** Result of `startSession`: the ready-to-host review session. */
export type ReviewStartOutcome =
  | {
      readonly ok: true;
      readonly cycle: TrainingCycleRow;
      readonly set: TacticalTrainingSetRow;
      readonly puzzles: ReadonlyMap<string, PuzzleRow>;
    }
  | { readonly ok: false; readonly reason: 'empty-queue' }
  | { readonly ok: false; readonly reason: 'invalid-config'; readonly message: string };

/** Result of `applyOutcome`: whether a grade was written and the new due instant. */
export interface ReviewApplyResult {
  readonly applied: boolean;
  readonly nextDueAt: number | null;
}

/** Result of one bounded `reconcile` pass. */
export interface ReviewReconcileResult {
  /** True when no rebuild candidates remain after this pass. */
  readonly done: boolean;
  /** Candidates examined this pass. */
  readonly processed: number;
  /** Rows (re)built from history this pass. */
  readonly rebuilt: number;
  /** Orphan rows dropped this pass. */
  readonly dropped: number;
}

/** Constructor options for `ReviewService`. */
export interface ReviewServiceOptions {
  readonly cycles: TrainingCyclesRepository;
  readonly sets: TrainingSetsRepository;
  readonly puzzles: PuzzlesRepository;
  readonly attempts: PuzzleAttemptsRepository;
  readonly schedules: ReviewSchedulesRepository;
  readonly settings: SettingsRepository;
  /** The injected scheduler (the `ts-fsrs` adapter in production). */
  readonly scheduler: Scheduler;
  /** Wall clock (Unix epoch millis); defaults to `Date.now`. */
  readonly now?: () => number;
  /** Id factory for new review cycle ids; defaults to `crypto.randomUUID()`. */
  readonly newId?: () => string;
  /** Bounded reconcile batch size; defaults to `SCHEDULE_REBUILD_BATCH`. */
  readonly reconcileBatchSize?: number;
}

/** The loaded persisted state `overview`/`startSession` derive from. */
interface ReviewState {
  readonly puzzles: readonly PuzzleRow[];
  readonly attempts: readonly PuzzleAttemptRow[];
  readonly cycles: readonly TrainingCycleRow[];
  readonly scheduleRows: readonly PuzzleScheduleRow[];
  readonly scheduleById: ReadonlyMap<string, PuzzleScheduleRow>;
  readonly caps: ReviewCaps;
  readonly dayUsage: DayUsage;
  readonly pendingRebuildIds: ReadonlySet<string>;
  readonly queue: readonly ReviewQueueEntry[];
}

export class ReviewService {
  private readonly cycles: TrainingCyclesRepository;
  private readonly sets: TrainingSetsRepository;
  private readonly puzzles: PuzzlesRepository;
  private readonly attempts: PuzzleAttemptsRepository;
  private readonly schedules: ReviewSchedulesRepository;
  private readonly settings: SettingsRepository;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly reconcileBatchSize: number;

  constructor(options: ReviewServiceOptions) {
    this.cycles = options.cycles;
    this.sets = options.sets;
    this.puzzles = options.puzzles;
    this.attempts = options.attempts;
    this.schedules = options.schedules;
    this.settings = options.settings;
    this.scheduler = options.scheduler;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.reconcileBatchSize = options.reconcileBatchSize ?? SCHEDULE_REBUILD_BATCH;
  }

  /** The derived review read model for the entry card / session setup. */
  async overview(now: number): Promise<ReviewOverview> {
    const state = await this.loadState(now);
    const dueNow = state.scheduleRows.filter((row) => row.dueAt <= now).length;
    const newCount = state.queue.filter((entry) => entry.kind === 'new').length;
    const nextDueAt = earliestFutureDue(state.scheduleRows, now);
    const retentionIds = new Set<string>();
    for (const entry of state.queue) {
      if (entry.kind === 'review') {
        retentionIds.add(entry.puzzleId);
      }
    }
    for (const id of todayReviewedIds(state.cycles, state.attempts, now)) {
      retentionIds.add(id);
    }
    const retentionStates: ScheduleState[] = [];
    for (const puzzleId of retentionIds) {
      const row = state.scheduleById.get(puzzleId);
      if (row !== undefined && !isScheduleCorrupt(row)) {
        retentionStates.push(row);
      }
    }
    return {
      dueNow,
      newCount,
      queue: state.queue,
      retention: this.retentionOf(retentionStates, now),
      nextDueAt,
      pendingRebuild: state.pendingRebuildIds.size,
      caps: state.caps,
      dayUsage: state.dayUsage,
    };
  }

  /**
   * One bounded reconcile pass: drop schedule rows whose puzzle no longer
   * exists, then rebuild missing/stale/corrupt rows from the immutable attempt
   * log. Idempotent, resumable and non-blocking; a partial pass leaves the
   * remaining puzzles pending (excluded from intake, never shown with a wrong
   * due date).
   */
  async reconcile(options: { readonly batchSize?: number } = {}): Promise<ReviewReconcileResult> {
    const batchSize = options.batchSize ?? this.reconcileBatchSize;
    const [puzzles, attempts, scheduleRows] = await Promise.all([
      this.puzzles.listAll(),
      this.attempts.listAll(),
      this.schedules.listAll(),
    ]);
    const puzzleIds = new Set(puzzles.map((row) => puzzleIdOf(row.sourceGameId, row.sourcePly)));

    const orphans = scheduleRows
      .filter((row) => !puzzleIds.has(row.puzzleId))
      .map((row) => row.puzzleId);
    if (orphans.length > 0) {
      await this.schedules.deleteForPuzzleIds(orphans);
    }

    const scheduleById = new Map(scheduleRows.map((row) => [row.puzzleId, row]));
    const gradeableByPuzzle = groupGradeableByPuzzle(attempts);
    const candidates: string[] = [];
    for (const puzzleId of gradeableByPuzzle.keys()) {
      const row = scheduleById.get(puzzleId);
      if (row === undefined || isScheduleStale(row) || isScheduleCorrupt(row)) {
        candidates.push(puzzleId);
      }
    }
    const slice = candidates.slice(0, Math.max(0, batchSize));
    let rebuilt = 0;
    for (const puzzleId of slice) {
      const rows = gradeableByPuzzle.get(puzzleId)!;
      const state = scheduleFromHistory(this.scheduler, rows);
      if (state === null) {
        continue;
      }
      await this.schedules.put(scheduleRowFrom(state, puzzleId, lastGradeOf(rows), this.now()));
      rebuilt += 1;
    }
    return {
      done: candidates.length <= slice.length,
      processed: slice.length,
      rebuilt,
      dropped: orphans.length,
    };
  }

  /**
   * Snapshot the current due queue into one review cycle under the reserved
   * `REVIEW_SET_ID` sentinel (no `trainingSets` row), abandoning any
   * in-progress review cycle first (the Quick-train cleanup). Refused with
   * `empty-queue` when nothing is due and no new intake is available.
   */
  async startSession(now: number): Promise<ReviewStartOutcome> {
    const check = validateCycleConfig(REVIEW_CYCLE_CONFIG);
    if (!check.ok) {
      return { ok: false, reason: 'invalid-config', message: check.message };
    }
    const state = await this.loadState(now);
    if (state.queue.length === 0) {
      return { ok: false, reason: 'empty-queue' };
    }

    const existing = await this.cycles.listForSet(REVIEW_SET_ID);
    for (const cycle of existing) {
      if (cycle.status === 'inProgress') {
        await this.cycles.updateStatus(cycle.id, { status: 'abandoned', abandonedAt: now });
      }
    }

    const puzzleIds = state.queue.map((entry) => entry.puzzleId);
    const cycle: TrainingCycleRow = {
      id: this.newId(),
      trainingSetId: REVIEW_SET_ID,
      cycleNumber: nextCycleNumber(existing.map((row) => row.cycleNumber)),
      status: 'inProgress',
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      abandonedAt: null,
      puzzleIds,
      config: check.config,
      cycleMetricsVersion: CYCLE_METRICS_VERSION,
    };
    await this.cycles.createReview(cycle);

    const puzzles = new Map(
      state.puzzles.map((row) => [puzzleIdOf(row.sourceGameId, row.sourcePly), row]),
    );
    return { ok: true, cycle, set: reviewSet(cycle), puzzles };
  }

  /**
   * Apply one definite outcome to its puzzle's schedule. A `skipped` outcome
   * applies no grade. A missing/stale/corrupt row is rebuilt from history; a
   * scheduler throw falls back to a full rebuild. A write failure is a
   * non-blocking `{ applied: false }` (the attempt row is already durable and
   * reconcile rebuilds the projection).
   */
  async applyOutcome(attemptRow: PuzzleAttemptRow): Promise<ReviewApplyResult> {
    const grade = gradeForAttempt(attemptRow);
    if (grade === null) {
      return { applied: false, nextDueAt: null };
    }
    try {
      const attempts = await this.attempts.listForPuzzle(attemptRow.puzzleId);
      const existing = await this.schedules.get(attemptRow.puzzleId);
      let state: ScheduleState | null;
      if (existing !== undefined && !isScheduleStale(existing) && !isScheduleCorrupt(existing)) {
        try {
          state = applyGrade(this.scheduler, existing, grade, attemptRow.endedAt);
        } catch {
          state = scheduleFromHistory(this.scheduler, attempts);
        }
      } else {
        state = scheduleFromHistory(this.scheduler, attempts);
      }
      if (state === null) {
        return { applied: false, nextDueAt: null };
      }
      await this.schedules.put(scheduleRowFrom(state, attemptRow.puzzleId, grade, this.now()));
      return { applied: true, nextDueAt: state.dueAt };
    } catch {
      return { applied: false, nextDueAt: null };
    }
  }

  /** Rebuild one puzzle's schedule from its full attempt history (or drop it). */
  async rebuildPuzzle(puzzleId: string): Promise<PuzzleScheduleRow | null> {
    const attempts = await this.attempts.listForPuzzle(puzzleId);
    const state = scheduleFromHistory(this.scheduler, attempts);
    if (state === null) {
      await this.schedules.deleteForPuzzleIds([puzzleId]);
      return null;
    }
    const row = scheduleRowFrom(state, puzzleId, lastGradeOf(attempts), this.now());
    await this.schedules.put(row);
    return row;
  }

  /** Average current retrievability over `states`, or `null` when empty. */
  retentionOf(states: readonly ScheduleState[], now: number): number | null {
    if (states.length === 0) {
      return null;
    }
    let total = 0;
    for (const state of states) {
      total += this.scheduler.retrievability(state, now);
    }
    return total / states.length;
  }

  /** Load and derive every input the overview/start path needs. */
  private async loadState(now: number): Promise<ReviewState> {
    const [puzzles, attempts, cycles, scheduleRows, storedNew, storedReview] = await Promise.all([
      this.puzzles.listAll(),
      this.attempts.listAll(),
      this.cycles.listAll(),
      this.schedules.listAll(),
      this.settings.get<number>(SETTINGS_KEYS.reviewDailyNewCap),
      this.settings.get<number>(SETTINGS_KEYS.reviewDailyReviewCap),
    ]);
    const caps = normalizeCaps({ newCap: storedNew, reviewCap: storedReview });
    const scheduleById = new Map(scheduleRows.map((row) => [row.puzzleId, row]));
    const openBlock = await this.sets.getOpenBlock();
    const pool = derivePool({
      puzzles,
      masteredIds: masteredPuzzleIds(attempts, cycles),
      openBlockPuzzleIds: new Set(openBlock?.puzzleIds ?? []),
    });
    const dayUsage = dayUsageOf({ cycles, attempts, now });
    const pendingRebuildIds = pendingRebuildIdsOf(attempts, scheduleById);
    const queue = dueQueue({
      schedules: scheduleRows,
      puzzles,
      pool,
      now,
      caps,
      dayUsage,
      pendingRebuildIds,
    });
    return {
      puzzles,
      attempts,
      cycles,
      scheduleRows,
      scheduleById,
      caps,
      dayUsage,
      pendingRebuildIds,
      queue,
    };
  }
}

/** A synthetic "Review" set for the session host (no `trainingSets` row). */
function reviewSet(cycle: TrainingCycleRow): TacticalTrainingSetRow {
  return {
    id: REVIEW_SET_ID,
    name: 'Review',
    createdAt: cycle.startedAt,
    updatedAt: cycle.startedAt,
    status: 'active',
    source: { kind: 'manual' },
    puzzleIds: cycle.puzzleIds,
    targetSize: cycle.puzzleIds.length,
    config: cycle.config,
  };
}

/** Gradeable (`result !== 'skipped'`) attempts grouped by puzzle id. */
function groupGradeableByPuzzle(
  attempts: readonly PuzzleAttemptRow[],
): Map<string, PuzzleAttemptRow[]> {
  const grouped = new Map<string, PuzzleAttemptRow[]>();
  for (const attempt of attempts) {
    if (attempt.result === 'skipped') {
      continue;
    }
    const bucket = grouped.get(attempt.puzzleId);
    if (bucket === undefined) {
      grouped.set(attempt.puzzleId, [attempt]);
    } else {
      bucket.push(attempt);
    }
  }
  return grouped;
}

/** The last grade of a puzzle's rows by `endedAt`/`presentationIndex`. */
function lastGradeOf(attempts: readonly PuzzleAttemptRow[]) {
  const gradeable = attempts.filter((attempt) => attempt.result !== 'skipped');
  if (gradeable.length === 0) {
    return null;
  }
  const ordered = [...gradeable].sort(
    (a, b) => a.endedAt - b.endedAt || a.presentationIndex - b.presentationIndex,
  );
  return gradeForAttempt(ordered[ordered.length - 1]!);
}

/** Puzzle ids with gradeable history whose schedule row needs a rebuild. */
function pendingRebuildIdsOf(
  attempts: readonly PuzzleAttemptRow[],
  scheduleById: ReadonlyMap<string, PuzzleScheduleRow>,
): ReadonlySet<string> {
  const pending = new Set<string>();
  for (const puzzleId of groupGradeableByPuzzle(attempts).keys()) {
    const row = scheduleById.get(puzzleId);
    if (row === undefined || isScheduleStale(row) || isScheduleCorrupt(row)) {
      pending.add(puzzleId);
    }
  }
  return pending;
}

/** The earliest `dueAt` strictly after `now`, or `null`. */
function earliestFutureDue(rows: readonly PuzzleScheduleRow[], now: number): number | null {
  let earliest: number | null = null;
  for (const row of rows) {
    if (row.dueAt > now && (earliest === null || row.dueAt < earliest)) {
      earliest = row.dueAt;
    }
  }
  return earliest;
}

/** Distinct puzzles presented in today's review cycles. */
function todayReviewedIds(
  cycles: readonly TrainingCycleRow[],
  attempts: readonly PuzzleAttemptRow[],
  now: number,
): ReadonlySet<string> {
  const todayCycleIds = new Set<string>();
  for (const cycle of cycles) {
    if (cycle.trainingSetId === REVIEW_SET_ID && isSameLocalCalendarDay(cycle.startedAt, now)) {
      todayCycleIds.add(cycle.id);
    }
  }
  const ids = new Set<string>();
  for (const attempt of attempts) {
    if (todayCycleIds.has(attempt.cycleId)) {
      ids.add(attempt.puzzleId);
    }
  }
  return ids;
}
