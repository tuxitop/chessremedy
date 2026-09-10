/**
 * Training-sets application service (Feature 013, Stage C).
 *
 * The engine-free orchestration layer between the pure Stage-A set domain and
 * the Stage-B `trainingSets` persistence: it loads the persisted puzzle/game
 * rows a set is seeded from, calls `resolveSetMembership` **once** to store a
 * fixed membership snapshot, and exposes the set lifecycle
 * (create/rename/configure/archive/unarchive/delete/list) as typed results.
 *
 * Determinism: the wall clock and id factory are injectable (`now`/`newId`,
 * plan R-8). No engine, network, React or worker import; the only side effects
 * are repository writes.
 *
 * A source that resolves zero puzzles still persists an **empty** set with an
 * explicit `empty` result flag — never a fake count and never an auto-delete
 * (spec "Error cases").
 */

import {
  DEFAULT_CYCLE_CONFIG,
  resolveSetMembership,
  validateCycleConfig,
  type CycleConfig,
  type OrderingPolicy,
  type PuzzlePoolEntry,
  type PuzzlePoolFilters,
  type SetSource,
  type TacticalTrainingSetRow,
  type TrainingSetStatus,
} from '@/domain/training';
import type { DifficultyBucketName } from '@/domain/puzzle/buckets';
import type { PuzzleOrigin, PuzzleRow } from '@/domain/puzzle/types';
import type {
  TrainingSetUpdate,
  TrainingSetsRepository,
} from '@/infrastructure/db/training-sets-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { GameSummary, GamesRepository } from '@/infrastructure/db/games-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';

/** Inputs to `TrainingSetsService.createFromGame`. */
export interface CreateSetFromGameInput {
  /** The source game whose puzzle rows seed the set. */
  readonly gameId: string;
  /** Human-readable set name. */
  readonly name: string;
  /** Optional origin filter applied to the game's puzzles. */
  readonly originFilter?: PuzzleOrigin;
  /** Optional difficulty-bucket filter applied to the game's puzzles. */
  readonly difficultyFilter?: DifficultyBucketName;
  /** Ordering policy applied after the source universe is resolved. */
  readonly ordering: OrderingPolicy;
  /** Creation target/cap; the first N under the ordering are stored. */
  readonly targetSize: number;
}

/** Inputs to `TrainingSetsService.createFromPool`. */
export interface CreateSetFromPoolInput {
  /** Pool filters narrowing the persisted puzzle universe. */
  readonly filters: PuzzlePoolFilters;
  /** Human-readable set name. */
  readonly name: string;
  /** Ordering policy applied after the pool filters resolve. */
  readonly ordering: OrderingPolicy;
  /** Creation target/cap; the first N under the ordering are stored. */
  readonly targetSize: number;
}

/** Inputs to `TrainingSetsService.createManual`. */
export interface CreateSetManualInput {
  /** Caller-selected membership ids in the desired manual base order. */
  readonly puzzleIds: readonly string[];
  /** Human-readable set name. */
  readonly name: string;
  /** Ordering policy applied after the manual selection resolves. */
  readonly ordering: OrderingPolicy;
  /** Creation target/cap; the first N under the ordering are stored. */
  readonly targetSize: number;
}

/** A create succeeded: the persisted set plus its real resolved membership size. */
export interface CreateSetSuccess {
  readonly ok: true;
  readonly set: TacticalTrainingSetRow;
  /** Number of membership ids actually resolved (may be `0`). */
  readonly resolvedCount: number;
  /** True when the source resolved no puzzle row (an explicit empty set). */
  readonly empty: boolean;
}

/** A config failed validation; nothing was persisted. */
export interface InvalidSetConfig {
  readonly ok: false;
  readonly reason: 'invalid-config';
  readonly message: string;
}

/** A referenced set does not exist. */
export interface SetNotFound {
  readonly ok: false;
  readonly reason: 'not-found';
}

/** Result of a create: the empty set is still a success. */
export type CreateSetResult = CreateSetSuccess | InvalidSetConfig;

/** Result of a set mutation: the stored row or a typed rejection. */
export type SetMutationResult =
  { readonly ok: true; readonly set: TacticalTrainingSetRow } | SetNotFound | InvalidSetConfig;

/** Constructor options for `TrainingSetsService`. */
export interface TrainingSetsServiceOptions {
  /** Feature-013 set rows (the fixed membership snapshot). */
  readonly sets: TrainingSetsRepository;
  /** Feature-011 puzzle rows (game/pool/manual source universes). */
  readonly puzzles: PuzzlesRepository;
  /** Feature-004 games (pool platform/time-control enrichment). */
  readonly games: GamesRepository;
  /**
   * Feature-012 attempt rows. Accepted as part of the documented Stage-C
   * dependency surface; set-owned attempt removal is performed transactionally
   * by `TrainingSetsRepository.delete`, so the service never writes here.
   */
  readonly attempts: PuzzleAttemptsRepository;
  /** Wall clock for create timestamps (Unix epoch millis); defaults to `Date.now`. */
  readonly now?: () => number;
  /** Id factory for new set ids; defaults to `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

export class TrainingSetsService {
  private readonly sets: TrainingSetsRepository;
  private readonly puzzles: PuzzlesRepository;
  private readonly games: GamesRepository;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: TrainingSetsServiceOptions) {
    this.sets = options.sets;
    this.puzzles = options.puzzles;
    this.games = options.games;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /**
   * Create a set from one game's puzzle rows, optionally narrowed by
   * origin/difficulty. Membership is resolved once and stored; a game with no
   * matching puzzle yields an explicit empty set.
   */
  async createFromGame(input: CreateSetFromGameInput): Promise<CreateSetResult> {
    const puzzles = await this.puzzles.listForGame(input.gameId);
    const source: SetSource = { kind: 'game', gameId: input.gameId };
    const puzzleIds = resolveSetMembership({
      source,
      puzzles,
      ordering: input.ordering,
      targetSize: input.targetSize,
      ...(input.originFilter === undefined ? {} : { originFilter: input.originFilter }),
      ...(input.difficultyFilter === undefined ? {} : { difficultyFilter: input.difficultyFilter }),
    });
    return this.persistNewSet(input.name, source, puzzleIds, input.ordering, input.targetSize);
  }

  /**
   * Create a set from the puzzle pool: every persisted puzzle matching the
   * filters, enriched with its source game's platform/time-control so the
   * platform and time-control filters are pure and deterministic.
   */
  async createFromPool(input: CreateSetFromPoolInput): Promise<CreateSetResult> {
    const [puzzles, summaries] = await Promise.all([
      this.puzzles.listAll(),
      this.games.listGameSummaries(),
    ]);
    const source: SetSource = { kind: 'pool', filters: input.filters };
    const puzzleIds = resolveSetMembership({
      source,
      puzzles,
      poolEntries: buildPoolEntries(puzzles, summaries),
      ordering: input.ordering,
      targetSize: input.targetSize,
    });
    return this.persistNewSet(input.name, source, puzzleIds, input.ordering, input.targetSize);
  }

  /**
   * Create a set from a caller-provided id selection. Ids whose puzzle row no
   * longer exists are dropped rather than fabricated; the surviving rows keep
   * the selection order as the manual base order.
   */
  async createManual(input: CreateSetManualInput): Promise<CreateSetResult> {
    const puzzles = await this.puzzles.getPuzzles(input.puzzleIds);
    const source: SetSource = { kind: 'manual' };
    const puzzleIds = resolveSetMembership({
      source,
      puzzles,
      manualIds: input.puzzleIds,
      ordering: input.ordering,
      targetSize: input.targetSize,
    });
    return this.persistNewSet(input.name, source, puzzleIds, input.ordering, input.targetSize);
  }

  /** Rename a set; `not-found` when the id is absent. */
  async rename(id: string, name: string): Promise<SetMutationResult> {
    return this.mutate(id, { name });
  }

  /**
   * Replace a set's config. The config is validated with
   * `validateCycleConfig`; an invalid/unknown persisted shape is rejected
   * (`invalid-config`) and never coerced.
   */
  async updateConfig(id: string, config: unknown): Promise<SetMutationResult> {
    const check = validateCycleConfig(config);
    if (!check.ok) {
      return { ok: false, reason: 'invalid-config', message: check.message };
    }
    return this.mutate(id, { config: check.config });
  }

  /** Archive a set (hidden from the active list, history retained). */
  async archive(id: string): Promise<SetMutationResult> {
    return this.mutate(id, { status: 'archived' });
  }

  /** Restore an archived set to the active list. */
  async unarchive(id: string): Promise<SetMutationResult> {
    return this.mutate(id, { status: 'active' });
  }

  /**
   * Delete a set and everything it owns (its cycles and their attempt rows, in
   * the repository's transaction). Puzzles are untouched. Idempotent result
   * reporting: an absent id is `not-found`.
   */
  async delete(id: string): Promise<{ readonly ok: true } | SetNotFound> {
    const existing = await this.sets.get(id);
    if (existing === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    await this.sets.delete(id);
    return { ok: true };
  }

  /** Sets filtered by status (default active), ordered by `createdAt` then id. */
  async list(
    options: { readonly status?: TrainingSetStatus } = {},
  ): Promise<TacticalTrainingSetRow[]> {
    return this.sets.list(options);
  }

  /** Persist a freshly resolved set with the default config for its ordering. */
  private async persistNewSet(
    name: string,
    source: SetSource,
    puzzleIds: readonly string[],
    ordering: OrderingPolicy,
    targetSize: number,
  ): Promise<CreateSetResult> {
    const config = defaultConfigFor(ordering);
    const check = validateCycleConfig(config);
    if (!check.ok) {
      return { ok: false, reason: 'invalid-config', message: check.message };
    }
    const now = this.now();
    const set: TacticalTrainingSetRow = {
      id: this.newId(),
      name,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      source,
      puzzleIds: [...puzzleIds],
      targetSize,
      config: check.config,
    };
    await this.sets.create(set);
    return { ok: true, set, resolvedCount: puzzleIds.length, empty: puzzleIds.length === 0 };
  }

  /** Apply a partial patch, mapping an absent id to the typed `not-found`. */
  private async mutate(id: string, patch: TrainingSetUpdate): Promise<SetMutationResult> {
    const updated = await this.sets.update(id, patch);
    if (updated === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    return { ok: true, set: updated };
  }
}

/** The default cycle config with the requested ordering, deep-cloned. */
function defaultConfigFor(ordering: OrderingPolicy): CycleConfig {
  return {
    ...DEFAULT_CYCLE_CONFIG,
    ordering,
    hints: {
      ...DEFAULT_CYCLE_CONFIG.hints,
      enabledLevels: [...DEFAULT_CYCLE_CONFIG.hints.enabledLevels],
    },
  };
}

/**
 * Enrich the persisted puzzle universe with each puzzle's source game
 * platform/time-control. A puzzle whose game summary is absent (should not
 * happen under the game-deletion cascade) is omitted rather than assigned a
 * fabricated enrichment.
 */
function buildPoolEntries(
  puzzles: readonly PuzzleRow[],
  summaries: readonly GameSummary[],
): PuzzlePoolEntry[] {
  const byGame = new Map(summaries.map((summary) => [summary.id, summary]));
  const entries: PuzzlePoolEntry[] = [];
  for (const puzzle of puzzles) {
    const summary = byGame.get(puzzle.sourceGameId);
    if (summary === undefined) {
      continue;
    }
    entries.push({
      puzzle,
      platform: summary.source,
      timeControlCategory: summary.normalizedTimeControl,
    });
  }
  return entries;
}
