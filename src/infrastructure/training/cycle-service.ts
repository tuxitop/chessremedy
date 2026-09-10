/**
 * Training-cycle application service (Feature 013, Stage C).
 *
 * The engine-free lifecycle layer over the Stage-A cycle domain and the
 * Stage-B `trainingCycles`/`trainingSets`/`puzzles`/`puzzleAttempts`
 * persistence. It owns:
 *
 * - `start` — snapshot a set's membership + config into a new 1-based cycle;
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
  computeCycleMetrics,
  deriveAutoSetMembership,
  masteredPuzzleIds,
  nextCycleNumber,
  reconstructResume,
  resolvePuzzleCycle,
  snapshotCycle,
  validateCycleConfig,
  type CycleMetrics,
  type CycleResolution,
  type ResumeQueue,
  type TacticalTrainingSetRow,
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

/**
 * An auto set's derived membership is empty because every pool puzzle is
 * mastered; cycle start is blocked (never a fake count or an empty cycle).
 */
export interface CycleAllMastered {
  readonly ok: false;
  readonly reason: 'all-mastered';
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
  | CycleAllMastered
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
  /** Feature-013 set rows (the cycle source). */
  readonly sets: TrainingSetsRepository;
  /** Feature-011 puzzle rows (membership hydration / missing-id tracking). */
  readonly puzzles: PuzzlesRepository;
  /** Feature-012 attempt rows (resume/metrics reads). */
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
   * Start a new cycle over a set: snapshot the stored membership and validated
   * config under the next 1-based cycle number. Rejected with `empty-set` when
   * the set has no surviving puzzle row (no empty cycle is created).
   *
   * An **auto** set's membership is virtual: it is re-derived here from the
   * current puzzle pool minus the derived mastery, persisted back onto the set
   * (so the training home's derived count is fresh) and snapshotted onto the
   * cycle. A derived-empty auto set is blocked as `empty-set` (no pool) or
   * `all-mastered` (every pool puzzle mastered); an existing in-progress cycle
   * is never touched. Game/pool/manual sets keep their stored membership.
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
    const membership = await this.resolveStartMembership(set);
    if (membership.kind === 'empty') {
      return { ok: false, reason: 'empty-set' };
    }
    if (membership.kind === 'all-mastered') {
      return { ok: false, reason: 'all-mastered' };
    }
    const puzzleIds = membership.puzzleIds;
    const missingPuzzleIds = await this.missingPuzzleIdsFor(puzzleIds);
    if (missingPuzzleIds.length === puzzleIds.length) {
      return { ok: false, reason: 'empty-set' };
    }
    const existing = await this.cycles.listForSet(setId);
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
   * Resolve the membership to snapshot at cycle start. Game/pool/manual sets
   * return their stored membership unchanged. An auto set re-derives from the
   * current pool + mastery, persists the refreshed ids on the set, and reports
   * a derived-empty pool as `empty` (no puzzles) or `all-mastered` (pool
   * non-empty but every puzzle mastered).
   */
  private async resolveStartMembership(
    set: TacticalTrainingSetRow,
  ): Promise<
    | { readonly kind: 'ready'; readonly puzzleIds: readonly string[] }
    | { readonly kind: 'empty' }
    | { readonly kind: 'all-mastered' }
  > {
    if (set.source.kind !== 'auto') {
      return { kind: 'ready', puzzleIds: set.puzzleIds };
    }
    const [pool, attempts] = await Promise.all([this.puzzles.listAll(), this.attempts.listAll()]);
    const masteredIds = masteredPuzzleIds(attempts);
    const puzzleIds = deriveAutoSetMembership({
      recipe: set.source.recipe,
      pool,
      masteredIds,
      setId: set.id,
    });
    await this.sets.update(set.id, { puzzleIds });
    if (puzzleIds.length > 0) {
      return { kind: 'ready', puzzleIds };
    }
    return pool.length === 0 ? { kind: 'empty' } : { kind: 'all-mastered' };
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
   * Start the next cycle over the current set (a new 1-based number and a fresh
   * membership/config snapshot). Semantic alias of `start` for the results
   * view's "Start next cycle" action.
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
