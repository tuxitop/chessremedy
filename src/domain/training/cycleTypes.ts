/**
 * Feature 013 — tactical training-set and cycle vocabulary (domain, pure).
 *
 * The shared model of the training lifecycle (ADR-031): a fixed
 * `TacticalTrainingSetRow` and the repeated `TrainingCycleRow`s over it. A
 * cycle snapshots the set's membership and config at start; every cycle
 * aggregate is a derived read model over the immutable `PuzzleAttemptRow`s
 * (Feature 012), never stored on the cycle. This module holds only types and
 * version constants — no React, Dexie, engine or network import.
 */

import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { DifficultyBucketName } from '@/domain/puzzle/buckets';
import type { PuzzleOrigin, PuzzleRow } from '@/domain/puzzle/types';
import type { TacticalObjective } from '@/domain/tactics';
import type { HintLevel } from './types';

/** Lifecycle status of a training set (`domain/tactical-training.md`). */
export type TrainingSetStatus = 'active' | 'archived';

/**
 * Deterministic ordering policy applied when a source resolves more puzzles
 * than `targetSize` (and to an explicit re-resolution).
 *
 * - `difficultyAsc` (default) — puzzle difficulty ascending, ties by puzzle id;
 * - `sourcePly` — by `sourceGameId` then `sourcePly` ascending;
 * - `manual` — the stored `puzzleIds` base order.
 */
export type OrderingPolicy = 'difficultyAsc' | 'sourcePly' | 'manual';

/**
 * Whether and when a puzzle whose first presentation was `failed` is offered a
 * bounded retry presentation within the same cycle.
 *
 * - `none` — one presentation per puzzle;
 * - `endOfCycle` (default) — retries after every first-pass puzzle;
 * - `immediate` — the failed puzzle is re-presented next (front of queue).
 */
export type RetryFailed = 'none' | 'endOfCycle' | 'immediate';

/** Hint-level availability and first-hint threshold (Feature 012 contract). */
export interface HintConfig {
  /** Which of the four hint levels the set enables (subset of `[1,2,3,4]`). */
  readonly enabledLevels: readonly HintLevel[];
  /** The level the first hint press reveals. */
  readonly firstHintLevel: HintLevel;
}

/**
 * The configuration that governs cycles started from a set. It is snapshotted
 * onto every `TrainingCycleRow` at start; editing the set affects only future
 * cycles.
 */
export interface CycleConfig {
  readonly ordering: OrderingPolicy;
  readonly retryFailed: RetryFailed;
  readonly hints: HintConfig;
  readonly allowSkip: boolean;
  /** Target accuracy in `[0,1]`, informational only; `null` when unset. */
  readonly targetAccuracy: number | null;
  /** Target solving time in millis, informational only; `null` when unset. */
  readonly targetSolvingTimeMs: number | null;
  /** Planned number of cycles, informational only; `null` when unset. */
  readonly plannedCycles: number | null;
  /** Semantics version of this config (ARCHITECTURE §9). */
  readonly configVersion: number;
}

/**
 * The pool-source filters that narrow the persisted puzzle universe. All
 * filters are optional and combine conjunctively; `platform` and
 * `timeControlCategory` read the enriched `PuzzlePoolEntry`.
 */
export interface PuzzlePoolFilters {
  readonly origin?: PuzzleOrigin;
  readonly tacticalObjective?: TacticalObjective;
  readonly difficultyBucket?: DifficultyBucketName;
  readonly sourceGameId?: string;
  readonly platform?: GameSource;
  readonly timeControlCategory?: TimeControlCategory;
}

/**
 * The system-seeded auto-set recipe. The recipe defines the deterministic
 * selection over the unmastered puzzle pool; it is stored in the set's
 * `source` and is not user-editable in V1.
 *
 * - `allPuzzles` — every unmastered pool puzzle;
 * - `woodpeckerRandom` — a deterministic `size`-puzzle subset of the unmastered
 *   pool (V1 `size = 200`), ranked by a stable hash of `setId + "\u0000" +
 *   puzzleId`.
 */
export type AutoSetRecipe =
  { readonly kind: 'allPuzzles' } | { readonly kind: 'woodpeckerRandom'; readonly size: number };

/**
 * Provenance of a set's membership. Display/provenance only — the
 * authoritative membership is the set's stored `puzzleIds` for game/pool/manual
 * sets and the per-cycle derived membership for `auto` sets.
 *
 * An `auto` source carries the system-seeded recipe; its membership is virtual
 * (re-derived from the pool and mastery at each cycle start), so its stored
 * `puzzleIds` is empty and non-authoritative (spec §3a).
 */
export type SetSource =
  | { readonly kind: 'game'; readonly gameId: string }
  | { readonly kind: 'pool'; readonly filters: PuzzlePoolFilters }
  | { readonly kind: 'manual' }
  | { readonly kind: 'auto'; readonly recipe: AutoSetRecipe };

/**
 * One puzzle in the pool view: the immutable row plus the source game's
 * platform/time-control enrichment used for pure filtering and display.
 */
export interface PuzzlePoolEntry {
  readonly puzzle: PuzzleRow;
  readonly platform: GameSource;
  readonly timeControlCategory: TimeControlCategory;
}

/**
 * A fixed collection of puzzles trained together. Membership is stored state
 * (a snapshot of the resolved source), never a live query; a puzzle may belong
 * to zero, one or many sets and membership is never stored on the puzzle.
 */
export interface TacticalTrainingSetRow {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: TrainingSetStatus;
  /**
   * Provenance/recipe. For game/pool/manual sets it is display only and
   * `puzzleIds` is authoritative; for `auto` sets it carries the recipe and the
   * membership is derived per cycle.
   */
  readonly source: SetSource;
  /**
   * Resolved membership, in the set's base order. Authoritative for
   * game/pool/manual sets; empty and non-authoritative for `auto` sets (whose
   * membership is derived at each cycle start).
   */
  readonly puzzleIds: readonly string[];
  /** Creation target/cap (default 10); ignored for `auto` sets (the recipe caps). */
  readonly targetSize: number;
  /** Current config; snapshotted onto each cycle at start. */
  readonly config: CycleConfig;
}

/** Lifecycle status of a training cycle. */
export type TrainingCycleStatus = 'inProgress' | 'completed' | 'abandoned';

/**
 * One pass through the puzzles of a set. The identity/snapshot fields are
 * stored; every aggregate is derived from the cycle's attempt rows.
 */
export interface TrainingCycleRow {
  readonly id: string;
  readonly trainingSetId: string;
  /** 1-based, unique per set (`[trainingSetId, cycleNumber]`). */
  readonly cycleNumber: number;
  readonly status: TrainingCycleStatus;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly abandonedAt: number | null;
  /** Ordered membership snapshot at cycle start (immutable). */
  readonly puzzleIds: readonly string[];
  /** Config snapshot at cycle start (immutable). */
  readonly config: CycleConfig;
  /** Aggregation-semantics version (ARCHITECTURE §9). */
  readonly cycleMetricsVersion: number;
}

/** Semantics version stamped onto every new `CycleConfig` (ARCHITECTURE §9). */
export const CYCLE_CONFIG_VERSION = 1;

/** Aggregation-semantics version stamped onto every new cycle (ARCHITECTURE §9). */
export const CYCLE_METRICS_VERSION = 1;

/** Default creation target/cap for a set (`domain/tactical-training.md`). */
export const DEFAULT_TARGET_SIZE = 10;

/**
 * The V1 default cycle configuration (`domain/tactical-training.md`).
 *
 * Levels `[1,2,3,4]` are all enabled with the first press at level 2 per the
 * Feature-012 owner UX ruling; the shipped Feature-012
 * `DEFAULT_SOLVE_HINT_CONFIG` enables `[2,3,4]` only. The cycle default keeps
 * level 1 available (the domain doc's "levels 1–4 enabled") while starting at
 * 2, so the first press still produces a visible square highlight.
 */
export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  ordering: 'difficultyAsc',
  retryFailed: 'endOfCycle',
  hints: { enabledLevels: [1, 2, 3, 4], firstHintLevel: 2 },
  allowSkip: true,
  targetAccuracy: null,
  targetSolvingTimeMs: null,
  plannedCycles: null,
  configVersion: CYCLE_CONFIG_VERSION,
};
