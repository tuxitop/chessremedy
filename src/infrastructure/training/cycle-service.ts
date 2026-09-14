/**
 * Training-cycle application service (Feature 013, Stage C).
 *
 * The engine-free lifecycle layer over the Stage-A cycle domain and the
 * Stage-B `trainingCycles`/`trainingSets`/`puzzles`/`puzzleAttempts`
 * persistence. It owns:
 *
 * - `start` — snapshot a set's **fixed stored membership** + config into a new
 *   1-based cycle (a block's membership is frozen at creation and never
 *   re-derived per cycle; this supersedes the former virtual/auto-refresh
 *   rule);
 * - `startQuickTrain` — an ad-hoc session over the whole derived pool under the
 *   reserved `QUICK_TRAIN_SET_ID` sentinel, with **no** `trainingSets` row; it
 *   **resumes** the latest in-progress sentinel cycle instead of starting a new
 *   one, and its attempts do not count toward mastery (spec §3c);
 * - `resume` — reconstruct the pending queue from persisted attempt rows (no
 *   stored cursor) and mark the cycle `completed` when nothing is pending;
 * - `abandon` — terminal user action that keeps the attempts;
 * - `repeat` — a new cycle over the current set (new number/snapshot);
 * - `results` — the per-puzzle resolutions, canonical aggregates and the
 *   same-set previous-cycle comparison inputs;
 * - `listForSet` — the cycle history.
 *
 * The service never writes an attempt row (Feature 012 owns that) and never
 * runs the engine. Clock/id reads are injectable (`now`/`newId`, plan R-8), and
 * a persisted config is always validated with `validateCycleConfig` — an
 * unknown enum/version is a typed error, never coerced. A puzzle whose row no
 * longer exists is tracked as missing (terminal, never queued, no attempt row);
 * a set with no puzzle row at all is rejected as `empty-set` so no empty cycle
 * is created.
 */

import {
  CYCLE_METRICS_VERSION,
  DEFAULT_CYCLE_CONFIG,
  QUICK_TRAIN_SET_ID,
  activeCycleOf,
  computeCycleMetrics,
  derivePool,
  formWoodpeckerBlock,
  masteredPuzzleIds,
  nextCycleNumber,
  reconstructResume,
  resolvePuzzleCycle,
  snapshotCycle,
  validateCycleConfig,
  type CycleMetrics,
  type CycleResolution,
  type ResumeQueue,
  type TrainingCycleRow,
  type TrainingCycleStatus,
} from '@/domain/training';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import type { TrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';

/** A set/cycle id does not exist. */
export interface CycleNotFound {
  readonly ok: false;
  readonly reason: 'not-found';
}

/** A persisted config failed validation; the read is refused, never coerced. */
export interface CycleInvalidConfig {
  readonly ok: false;
  readonly reason: 'invalid-config';
  readonly message: string;
}

/** A set has no surviving puzzle row; no empty cycle may be created. */
export interface CycleEmptySet {
  readonly ok: false;
  readonly reason: 'empty-set';
}

/** Quick train was refused because the derived pool is empty (spec §3c). */
export interface CycleEmptyPool {
  readonly ok: false;
  readonly reason: 'empty-pool';
}

/** The cycle is already terminal and cannot be started/resumed/abandoned. */
export interface CycleNotResumable {
  readonly ok: false;
  readonly reason: 'not-resumable';
  readonly status: TrainingCycleStatus;
}

/** The cycle is `completed` and cannot be abandoned. */
export interface CycleNotAbandonable {
  readonly ok: false;
  readonly reason: 'not-abandonable';
  readonly status: TrainingCycleStatus;
}

/** Result of `start`/`repeat`: the persisted in-progress cycle. */
export type CycleStartResult =
  | {
      readonly ok: true;
      readonly cycle: TrainingCycleRow;
      /** Snapshot ids whose puzzle row no longer exists (terminal, never queued). */
      readonly missingPuzzleIds: readonly string[];
    }
  | CycleNotFound
  | CycleEmptySet
  | CycleInvalidConfig;

/**
 * Result of `startQuickTrain`: a real `trainingCycles` row under the
 * `QUICK_TRAIN_SET_ID` sentinel (no `trainingSets` row) whose snapshot is the
 * difficulty-ascending pool. The pool is derived from persisted rows, so its
 * snapshot can never contain a missing puzzle id.
 */
export type CycleQuickTrainResult =
  | {
      readonly ok: true;
      readonly cycle: TrainingCycleRow;
      readonly missingPuzzleIds: readonly string[];
    }
  | CycleEmptyPool
  | CycleInvalidConfig;

/** Result of `resume`: the reconstructed queue and completion state. */
export type CycleResumeResult =
  | {
      readonly ok: true;
      readonly cycle: TrainingCycleRow;
      readonly queue: ResumeQueue;
      /** True when nothing was pending (the cycle was marked `completed`). */
      readonly complete: boolean;
      readonly missingPuzzleIds: readonly string[];
    }
  | CycleNotFound
  | CycleInvalidConfig
  | CycleNotResumable;

/** Result of `abandon`: the terminal (or already-terminal) cycle. */
export type CycleAbandonResult =
  { readonly ok: true; readonly cycle: TrainingCycleRow } | CycleNotFound | CycleNotAbandonable;

/** The immediately preceding cycle of the same set plus its canonical metrics. */
export interface CycleComparisonInput {
  readonly cycle: TrainingCycleRow;
  readonly metrics: CycleMetrics;
}

/** The read model `results` returns for the cycle-results view. */
export interface CycleResults {
  readonly cycle: TrainingCycleRow;
  /** One resolution per snapshot puzzle, in snapshot order. */
  readonly resolutions: readonly CycleResolution[];
  /** The canonical aggregates (Feature 014 §8, shared). */
  readonly metrics: CycleMetrics;
  /** Snapshot ids whose puzzle row no longer exists (excluded from metrics). */
  readonly missingPuzzleIds: readonly string[];
  /** The previous cycle of the same set, when one exists (comparison input). */
  readonly previous: CycleComparisonInput | null;
}

/** Result of `results`. */
export type CycleResultsResult =
  { readonly ok: true; readonly results: CycleResults } | CycleNotFound | CycleInvalidConfig;

/** Constructor options for `CycleService`. */
export interface CycleServiceOptions {
  /** Feature-013 cycle rows. */
  readonly cycles: TrainingCyclesRepository;
  /** Feature-013 set rows (the cycle source; also the open-block read for Quick train). */
  readonly sets: TrainingSetsRepository;
  /** Feature-011 puzzle rows (membership hydration / missing-id tracking). */
  readonly puzzles: PuzzlesRepository;
  /** Feature-012 attempt rows (resume/metrics/mastery reads). */
  readonly attempts: PuzzleAttemptsRepository;
  /** Wall clock for cycle timestamps (Unix epoch millis); defaults to `Date.now`. */
  readonly now?: () => number;
  /** Id factory for new cycle ids; defaults to `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

export class CycleService {
  private readonly cycles: TrainingCyclesRepository;
  private readonly sets: TrainingSetsRepository;
  private readonly puzzles: PuzzlesRepository;
  private readonly attempts: PuzzleAttemptsRepository;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: CycleServiceOptions) {
    this.cycles = options.cycles;
    this.sets = options.sets;
    this.puzzles = options.puzzles;
    this.attempts = options.attempts;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /**
   * Start a new cycle over a set: snapshot the set's **fixed stored membership**
   * and validated config under the next 1-based cycle number. A Woodpecker
   * block's membership was frozen at creation, so it is snapshotted verbatim
   * and never re-derived here. Rejected with `empty-set` when the set has no
   * membership or no surviving puzzle row (no empty cycle is created).
   */
  async start(setId: string): Promise<CycleStartResult> {
    const set = await this.sets.get(setId);
    if (set === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    const check = validateCycleConfig(set.config);
    if (!check.ok) {
      return { ok: false, reason: 'invalid-config', message: check.message };
    }
    const puzzleIds = set.puzzleIds;
    const missingPuzzleIds = await this.missingPuzzleIdsFor(puzzleIds);
    if (puzzleIds.length === 0 || missingPuzzleIds.length === puzzleIds.length) {
      return { ok: false, reason: 'empty-set' };
    }
    const existing = await this.cycles.listForSet(setId);
    const active = activeCycleOf(existing, await this.attempts.listAll());
    if (active !== null) {
      // Never create a second in-progress pass for the same set: starting an
      // already-running set resumes the pass being worked through instead (a
      // duplicate cycle would shadow the real one in the UI). The UI resumes
      // first; this guards races. Any stray duplicate is abandoned so the
      // history shows a single in-progress pass.
      await this.abandonOtherInProgress(existing, active.id);
      return { ok: true, cycle: active, missingPuzzleIds };
    }
    const cycleNumber = nextCycleNumber(existing.map((cycle) => cycle.cycleNumber));
    const cycle = snapshotCycle({
      id: this.newId(),
      set,
      cycleNumber,
      puzzleIds,
      config: check.config,
      now: this.now(),
    });
    await this.cycles.create(cycle);
    return { ok: true, cycle, missingPuzzleIds };
  }

  /**
   * Start or **resume** the **Quick train** ad-hoc session over the whole
   * derived pool (spec §3c): the unmastered puzzles not in the currently-open
   * block, in `difficultyAsc` order. It creates **no** `trainingSets` row; it
   * writes a real `trainingCycles` row under the reserved `QUICK_TRAIN_SET_ID`
   * sentinel so every attempt keeps a real `cycleId`/`trainingSetId`. Its
   * attempts do **not** count toward mastery (owner decision; see `mastery.ts`).
   *
   * Re-starting resumes the latest `inProgress` sentinel cycle (abandoning any
   * other in-progress sentinel cycles) without creating a new cycle or
   * recomputing the pool; a fresh sentinel cycle is created only when none is in
   * progress. Refused with `empty-pool` when a fresh cycle would be created over
   * an empty pool (no cycle row is created).
   */
  async startQuickTrain(): Promise<CycleQuickTrainResult> {
    const existing = await this.cycles.listForSet(QUICK_TRAIN_SET_ID);
    const inProgress = existing.filter((cycle) => cycle.status === 'inProgress');
    if (inProgress.length > 0) {
      // `listForSet` is cycleNumber-ascending, so the last entry is the latest.
      const latest = inProgress[inProgress.length - 1]!;
      for (const cycle of inProgress) {
        if (cycle.id !== latest.id) {
          await this.cycles.updateStatus(cycle.id, {
            status: 'abandoned',
            abandonedAt: this.now(),
          });
        }
      }
      return { ok: true, cycle: latest, missingPuzzleIds: [] };
    }

    const check = validateCycleConfig(DEFAULT_CYCLE_CONFIG);
    if (!check.ok) {
      return { ok: false, reason: 'invalid-config', message: check.message };
    }
    const [puzzles, attempts, openBlock, cycles] = await Promise.all([
      this.puzzles.listAll(),
      this.attempts.listAll(),
      this.sets.getOpenBlock(),
      this.cycles.listAll(),
    ]);
    const masteredIds = masteredPuzzleIds(attempts, cycles);
    const pool = derivePool({
      puzzles,
      masteredIds,
      openBlockPuzzleIds: new Set(openBlock?.puzzleIds ?? []),
    });
    const puzzleIds = formWoodpeckerBlock({ pool, masteredIds, size: pool.length });
    if (puzzleIds.length === 0) {
      return { ok: false, reason: 'empty-pool' };
    }
    const cycleNumber = nextCycleNumber(existing.map((cycle) => cycle.cycleNumber));
    const startedAt = this.now();
    const cycle: TrainingCycleRow = {
      id: this.newId(),
      trainingSetId: QUICK_TRAIN_SET_ID,
      cycleNumber,
      status: 'inProgress',
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      abandonedAt: null,
      puzzleIds: [...puzzleIds],
      config: check.config,
      cycleMetricsVersion: CYCLE_METRICS_VERSION,
    };
    await this.cycles.createQuickTrain(cycle);
    return { ok: true, cycle, missingPuzzleIds: [] };
  }

  /**
   * Reconstruct the cycle's pending queue from persisted rows. When nothing is
   * pending the cycle is marked `completed` and the terminal state is returned.
   * A `completed`/`abandoned` cycle is refused (`not-resumable`); an invalid
   * persisted config is refused (`invalid-config`).
   */
  async resume(cycleId: string): Promise<CycleResumeResult> {
    const cycle = await this.cycles.get(cycleId);
    if (cycle === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    if (cycle.status !== 'inProgress') {
      return { ok: false, reason: 'not-resumable', status: cycle.status };
    }
    const check = validateCycleConfig(cycle.config);
    if (!check.ok) {
      return { ok: false, reason: 'invalid-config', message: check.message };
    }
    // The resumed pass is the active one; abandon any legacy/raced duplicate so
    // the history shows a single in-progress cycle.
    await this.abandonOtherInProgress(await this.cycles.listForSet(cycle.trainingSetId), cycleId);
    const attempts = await this.attempts.listForCycle(cycleId);
    const missingPuzzleIds = await this.missingPuzzleIdsFor(cycle.puzzleIds);
    const queue = reconstructResume({
      puzzleIds: cycle.puzzleIds,
      attempts,
      retryFailed: check.config.retryFailed,
      missingPuzzleIds: new Set(missingPuzzleIds),
    });
    if (queue.length === 0) {
      const completed = await this.cycles.updateStatus(cycleId, {
        status: 'completed',
        completedAt: this.now(),
      });
      return {
        ok: true,
        cycle: completed ?? cycle,
        queue,
        complete: true,
        missingPuzzleIds,
      };
    }
    return { ok: true, cycle, queue, complete: false, missingPuzzleIds };
  }

  /**
   * Abandon an in-progress cycle. Terminal and never resumable; the recorded
   * attempts are kept. An already-abandoned cycle is returned unchanged
   * (idempotent); a `completed` cycle cannot be abandoned.
   */
  async abandon(cycleId: string): Promise<CycleAbandonResult> {
    const cycle = await this.cycles.get(cycleId);
    if (cycle === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    if (cycle.status === 'abandoned') {
      return { ok: true, cycle };
    }
    if (cycle.status === 'completed') {
      return { ok: false, reason: 'not-abandonable', status: cycle.status };
    }
    const abandoned = await this.cycles.updateStatus(cycleId, {
      status: 'abandoned',
      abandonedAt: this.now(),
    });
    return { ok: true, cycle: abandoned ?? cycle };
  }

  /**
   * Reconcile a set's in-progress cycles to the single active pass, abandoning
   * any legacy/raced duplicates. A set is meant to have one in-progress cycle,
   * but interrupted starts (and pre-`activeCycleOf` builds) can leave several;
   * without this the history would show two "In progress" rows. Returns the
   * number abandoned; a no-op when the set has zero or one in-progress cycle.
   */
  async reconcileInProgress(setId: string): Promise<number> {
    const cycles = await this.cycles.listForSet(setId);
    const inProgress = cycles.filter((cycle) => cycle.status === 'inProgress');
    if (inProgress.length <= 1) {
      return 0;
    }
    const active = activeCycleOf(cycles, await this.attempts.listAll());
    return this.abandonOtherInProgress(cycles, active?.id ?? null);
  }

  /**
   * Abandon every in-progress cycle except `keepId` (pass `null` to abandon
   * all), stamping `abandonedAt` with the service clock. Returns the number
   * abandoned.
   */
  private async abandonOtherInProgress(
    cycles: readonly TrainingCycleRow[],
    keepId: string | null,
  ): Promise<number> {
    const now = this.now();
    let abandoned = 0;
    for (const cycle of cycles) {
      if (cycle.status === 'inProgress' && cycle.id !== keepId) {
        await this.cycles.updateStatus(cycle.id, { status: 'abandoned', abandonedAt: now });
        abandoned += 1;
      }
    }
    return abandoned;
  }

  /**
   * Start the next cycle over the current set (a new 1-based number and a fresh
   * snapshot of the set's fixed stored membership/config). Semantic alias of
   * `start` for the results view's "Start next cycle" action.
   */
  async repeat(setId: string): Promise<CycleStartResult> {
    return this.start(setId);
  }

  /**
   * Read one cycle's results: per-puzzle resolutions, the canonical aggregates
   * (shared with Feature 014) and the previous same-set cycle's metrics as the
   * comparison input. Missing snapshot puzzles are excluded from the metrics
   * but listed explicitly.
   */
  async results(cycleId: string): Promise<CycleResultsResult> {
    const cycle = await this.cycles.get(cycleId);
    if (cycle === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    const check = validateCycleConfig(cycle.config);
    if (!check.ok) {
      return { ok: false, reason: 'invalid-config', message: check.message };
    }
    const attempts = await this.attempts.listForCycle(cycleId);
    const missingPuzzleIds = await this.missingPuzzleIdsFor(cycle.puzzleIds);
    const resolutions = cycle.puzzleIds.map((puzzleId) =>
      resolvePuzzleCycle(
        puzzleId,
        attempts.filter((row) => row.puzzleId === puzzleId),
      ),
    );
    const metrics = computeCycleMetrics({
      puzzleIds: cycle.puzzleIds,
      attempts,
      missingPuzzleIds: new Set(missingPuzzleIds),
    });
    return {
      ok: true,
      results: {
        cycle,
        resolutions,
        metrics,
        missingPuzzleIds,
        previous: await this.previousComparison(cycle),
      },
    };
  }

  /** Every cycle of one set, ordered by `cycleNumber` ascending (history). */
  async listForSet(setId: string): Promise<TrainingCycleRow[]> {
    return this.cycles.listForSet(setId);
  }

  /** The immediately preceding cycle of the same set and its metrics, if any. */
  private async previousComparison(cycle: TrainingCycleRow): Promise<CycleComparisonInput | null> {
    const siblings = await this.cycles.listForSet(cycle.trainingSetId);
    let previous: TrainingCycleRow | null = null;
    for (const sibling of siblings) {
      if (sibling.cycleNumber < cycle.cycleNumber) {
        previous = sibling;
      }
    }
    if (previous === null) {
      return null;
    }
    const attempts = await this.attempts.listForCycle(previous.id);
    const missingPuzzleIds = await this.missingPuzzleIdsFor(previous.puzzleIds);
    return {
      cycle: previous,
      metrics: computeCycleMetrics({
        puzzleIds: previous.puzzleIds,
        attempts,
        missingPuzzleIds: new Set(missingPuzzleIds),
      }),
    };
  }

  /**
   * The membership ids whose puzzle row no longer exists, in snapshot order.
   * Hydrates through one bulk read (`getPuzzles`); an empty membership yields
   * an empty list.
   */
  private async missingPuzzleIdsFor(puzzleIds: readonly string[]): Promise<string[]> {
    if (puzzleIds.length === 0) {
      return [];
    }
    const rows = await this.puzzles.getPuzzles(puzzleIds);
    const present = new Set(rows.map((row) => puzzleIdOf(row.sourceGameId, row.sourcePly)));
    return puzzleIds.filter((id) => !present.has(id));
  }
}
