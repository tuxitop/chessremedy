/**
 * Training-sets application service (Feature 013, Stage C).
 *
 * The engine-free orchestration layer between the pure Stage-A set domain and
 * the Stage-B `trainingSets` persistence: it loads the persisted puzzle/game
 * rows a set is seeded from, calls `resolveSetMembership` **once** to store a
 * fixed membership snapshot, and exposes the set lifecycle
 * (create/rename/configure/archive/unarchive/delete/list) as typed results.
 *
 * This revision owns the **derived pool** and the one-click **Woodpecker
 * block** (spec §3a): the app never seeds or auto-forms a set, so there is no
 * `ensureAutoSets()`. A block is created only by an explicit
 * `createWoodpeckerBlock` call, freezes the easiest-N pool selection as its
 * `puzzleIds`, and is closed (`status: 'archived'`) by `closeBlock`; its
 * still-unmastered members return to the pool implicitly because the pool
 * excludes only the currently-**open** block's members.
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
  WOODPECKER_PLAN_CYCLES,
  derivePool,
  formWoodpeckerBlock,
  masteredPuzzleIds,
  resolveSetMembership,
  validateCycleConfig,
  validateHintConfig,
  type CycleConfig,
  type HintConfig,
  type OrderingPolicy,
  type PuzzlePoolEntry,
  type PuzzlePoolFilters,
  type SetSource,
  type TacticalTrainingSetRow,
  type TrainingSetStatus,
} from '@/domain/training';
import type { DifficultyBucketName } from '@/domain/puzzle/buckets';
import type { PuzzleOrigin, PuzzleRow } from '@/domain/puzzle/types';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import type {
  TrainingSetUpdate,
  TrainingSetsRepository,
} from '@/infrastructure/db/training-sets-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { GameSummary, GamesRepository } from '@/infrastructure/db/games-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';

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

/** Inputs to `TrainingSetsService.createWoodpeckerBlock`. */
export interface CreateWoodpeckerBlockInput {
  /**
   * Requested cap (`100 | 200 | 400`, default `DEFAULT_BLOCK_SIZE`). When the
   * pool is smaller, the block takes all of it.
   */
  readonly size: number;
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

/** A Woodpecker block was created: the frozen snapshot plus its real size. */
export interface CreateBlockSuccess {
  readonly ok: true;
  readonly set: TacticalTrainingSetRow;
  /** Number of pool puzzles actually selected (may be below the requested size). */
  readonly selectedCount: number;
}

/** Block creation was refused because a block is already open (spec §3a). */
export interface BlockAlreadyOpen {
  readonly ok: false;
  readonly reason: 'block-open';
  /** The currently-open block the UI should show instead. */
  readonly block: TacticalTrainingSetRow;
}

/** Block creation was refused because the derived pool is empty (spec §3a). */
export interface BlockEmptyPool {
  readonly ok: false;
  readonly reason: 'empty-pool';
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

/**
 * A mutation was refused because the set is a one-click Woodpecker block: a
 * block has no rename, no membership editing and no per-cycle refresh; it
 * closes via `closeBlock` (Finish/Abandon) only.
 */
export interface AutoSetImmutable {
  readonly ok: false;
  readonly reason: 'auto-set-immutable';
}

/** `closeBlock` was called for a set that is not a Woodpecker block. */
export interface NotABlock {
  readonly ok: false;
  readonly reason: 'not-a-block';
}

/** Result of a create: the empty set is still a success. */
export type CreateSetResult = CreateSetSuccess | InvalidSetConfig;

/** Result of a block create: the frozen snapshot or a typed refusal. */
export type CreateBlockResult = CreateBlockSuccess | BlockAlreadyOpen | BlockEmptyPool;

/** Result of a set mutation: the stored row or a typed rejection. */
export type SetMutationResult =
  | { readonly ok: true; readonly set: TacticalTrainingSetRow }
  | SetNotFound
  | InvalidSetConfig
  | AutoSetImmutable
  | NotABlock;

/** Result of a set deletion: success or a typed rejection. */
export type SetDeleteResult = { readonly ok: true } | SetNotFound | AutoSetImmutable;

/** Constructor options for `TrainingSetsService`. */
export interface TrainingSetsServiceOptions {
  /** Feature-013 set rows (the fixed membership snapshot). */
  readonly sets: TrainingSetsRepository;
  /** Feature-011 puzzle rows (game/pool/manual source universes). */
  readonly puzzles: PuzzlesRepository;
  /** Feature-004 games (pool platform/time-control enrichment). */
  readonly games: GamesRepository;
  /**
   * Feature-012 attempt rows. Used for the derived-mastery read behind the
   * pool (`masteredPuzzleIds`); set-owned attempt removal is performed
   * transactionally by `TrainingSetsRepository.delete`, so the service never
   * writes here.
   */
  readonly attempts: PuzzleAttemptsRepository;
  /**
   * Feature-013 cycle rows. Used for the derived-mastery read behind the pool
   * (`masteredPuzzleIds`), which ignores orphaned attempts, and to abandon a
   * block's still-in-progress cycle when the block is closed.
   */
  readonly cycles: TrainingCyclesRepository;
  /** Wall clock for create timestamps (Unix epoch millis); defaults to `Date.now`. */
  readonly now?: () => number;
  /** Id factory for new set ids; defaults to `crypto.randomUUID()`. */
  readonly newId?: () => string;
  /**
   * Resolves the global default `HintConfig` used to seed **new** sets/blocks
   * (Feature 017 §7). Defaults to a settings-repo read normalised with
   * `validateHintConfig`, falling back to `DEFAULT_CYCLE_CONFIG.hints`.
   */
  readonly readDefaultHintConfig?: () => Promise<HintConfig>;
}

export class TrainingSetsService {
  private readonly sets: TrainingSetsRepository;
  private readonly puzzles: PuzzlesRepository;
  private readonly games: GamesRepository;
  private readonly attempts: PuzzleAttemptsRepository;
  private readonly cycles: TrainingCyclesRepository;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly readDefaultHintConfig: () => Promise<HintConfig>;

  constructor(options: TrainingSetsServiceOptions) {
    this.sets = options.sets;
    this.puzzles = options.puzzles;
    this.games = options.games;
    this.attempts = options.attempts;
    this.cycles = options.cycles;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.readDefaultHintConfig = options.readDefaultHintConfig ?? readStoredDefaultHintConfig;
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

  /**
   * Derive the training **pool** at read time: every owned puzzle that is
   * neither mastered (a legitimate first-try solve in 3 distinct cycles) nor a
   * member of the currently-open block (spec §1/§3). The pool is a view — it is
   * never stored as a set.
   */
  async listPool(): Promise<PuzzleRow[]> {
    const [puzzles, attempts, openBlock, cycles] = await Promise.all([
      this.puzzles.listAll(),
      this.attempts.listAll(),
      this.sets.getOpenBlock(),
      this.cycles.listAll(),
    ]);
    return derivePool({
      puzzles,
      masteredIds: masteredPuzzleIds(attempts, cycles),
      openBlockPuzzleIds: new Set(openBlock?.puzzleIds ?? []),
    });
  }

  /** The single open Woodpecker block, or `undefined` when none is open. */
  async getOpenBlock(): Promise<TacticalTrainingSetRow | undefined> {
    return this.sets.getOpenBlock();
  }

  /**
   * Form and persist a one-click **Woodpecker block** from the derived pool
   * (spec §3a). The selection is the easiest-`size` pool puzzles in
   * `difficultyAsc` order (ties by `sourcePly`, then `puzzleId`); when the pool
   * is smaller than `size` the block holds all of it. Membership is frozen as
   * the block's `puzzleIds` and is never re-derived per cycle.
   *
   * Refused with `block-open` while a block is already open (only one at a
   * time) and with `empty-pool` when there is nothing to select — never an
   * empty or fabricated block.
   */
  async createWoodpeckerBlock(input: CreateWoodpeckerBlockInput): Promise<CreateBlockResult> {
    const openBlock = await this.sets.getOpenBlock();
    if (openBlock !== undefined) {
      return { ok: false, reason: 'block-open', block: openBlock };
    }
    const [puzzles, attempts, cycles] = await Promise.all([
      this.puzzles.listAll(),
      this.attempts.listAll(),
      this.cycles.listAll(),
    ]);
    const masteredIds = masteredPuzzleIds(attempts, cycles);
    const pool = derivePool({
      puzzles,
      masteredIds,
      openBlockPuzzleIds: new Set(),
    });
    const puzzleIds = formWoodpeckerBlock({ pool, masteredIds, size: input.size });
    if (puzzleIds.length === 0) {
      return { ok: false, reason: 'empty-pool' };
    }
    const config = blockConfig(await this.readDefaultHintConfig());
    const check = validateCycleConfig(config);
    if (!check.ok) {
      // Unreachable for the fixed block preset; kept so a future edit cannot
      // persist an invalid config silently.
      throw new Error(`Invalid block config: ${check.message}`);
    }
    const now = this.now();
    const set: TacticalTrainingSetRow = {
      id: this.newId(),
      name: 'Woodpecker block',
      createdAt: now,
      updatedAt: now,
      status: 'active',
      source: { kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: input.size } },
      puzzleIds,
      targetSize: input.size,
      config: check.config,
    };
    await this.sets.create(set);
    return { ok: true, set, selectedCount: puzzleIds.length };
  }

  /**
   * Close an open Woodpecker block: Finish/Abandon reuses `status: 'archived'`
   * (no new field, schema stays v10). Any cycle of the block still
   * `inProgress` is abandoned with the same `now`, so a closed block never
   * leaves a resumable cycle behind. Its still-unmastered members return to the
   * pool implicitly — the pool excludes only the **open** block's members, so no
   * membership is mutated here. Idempotent: an already-closed block is returned
   * unchanged.
   */
  async closeBlock(id: string): Promise<SetMutationResult> {
    const existing = await this.sets.get(id);
    if (existing === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    if (!isBlock(existing)) {
      return { ok: false, reason: 'not-a-block' };
    }
    if (existing.status === 'archived') {
      return { ok: true, set: existing };
    }
    const now = this.now();
    const cycles = await this.cycles.listForSet(id);
    for (const cycle of cycles) {
      if (cycle.status === 'inProgress') {
        await this.cycles.updateStatus(cycle.id, { status: 'abandoned', abandonedAt: now });
      }
    }
    const closed = await this.sets.closeBlock(id, now);
    if (closed === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    return { ok: true, set: closed };
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
   * reporting: an absent id is `not-found`; a Woodpecker block is refused
   * (`auto-set-immutable`) — a block is closed, never deleted.
   */
  async delete(id: string): Promise<SetDeleteResult> {
    const existing = await this.sets.get(id);
    if (existing === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    if (isBlock(existing)) {
      return { ok: false, reason: 'auto-set-immutable' };
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
    const config = defaultConfigFor(ordering, await this.readDefaultHintConfig());
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

  /**
   * Apply a partial patch, mapping an absent id to the typed `not-found` and a
   * one-click block to the typed `auto-set-immutable`.
   */
  private async mutate(id: string, patch: TrainingSetUpdate): Promise<SetMutationResult> {
    const existing = await this.sets.get(id);
    if (existing === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    if (isBlock(existing)) {
      return { ok: false, reason: 'auto-set-immutable' };
    }
    const updated = await this.sets.update(id, patch);
    if (updated === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    return { ok: true, set: updated };
  }
}

/** Whether a set is a one-click Woodpecker block (`source.kind === 'auto'`). */
function isBlock(set: TacticalTrainingSetRow): boolean {
  return set.source.kind === 'auto';
}

/** The default cycle config with the requested ordering and global hints. */
function defaultConfigFor(ordering: OrderingPolicy, hints: HintConfig): CycleConfig {
  return {
    ...DEFAULT_CYCLE_CONFIG,
    ordering,
    hints: { enabledLevels: [...hints.enabledLevels], firstHintLevel: hints.firstHintLevel },
  };
}

/**
 * The fixed Woodpecker block preset (spec §3a, `domain/tactical-training.md`):
 * `difficultyAsc`, retry `endOfCycle`, the global hints, skipping allowed, no
 * accuracy gate (`targetAccuracy`/`targetSolvingTimeMs` unset), and the
 * suggested ~6-cycle plan as the informational `plannedCycles`.
 */
function blockConfig(hints: HintConfig): CycleConfig {
  return {
    ...DEFAULT_CYCLE_CONFIG,
    ordering: 'difficultyAsc',
    retryFailed: 'endOfCycle',
    allowSkip: true,
    targetAccuracy: null,
    targetSolvingTimeMs: null,
    plannedCycles: WOODPECKER_PLAN_CYCLES,
    hints: { enabledLevels: [...hints.enabledLevels], firstHintLevel: hints.firstHintLevel },
  };
}

/**
 * Production default-hint reader: the stored `training.hints` value validated
 * and normalised, falling back to `DEFAULT_CYCLE_CONFIG.hints` when unset or
 * invalid (never a crash).
 */
async function readStoredDefaultHintConfig(): Promise<HintConfig> {
  try {
    const stored = await settingsRepository.get<unknown>(SETTINGS_KEYS.defaultHintConfig);
    if (stored !== undefined) {
      const check = validateHintConfig(stored);
      if (check.ok) {
        return check.config;
      }
    }
  } catch {
    // Fall through to the hardcoded default.
  }
  return DEFAULT_CYCLE_CONFIG.hints;
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
