/**
 * Feature 013 — auto-generated Woodpecker sets (domain, pure).
 *
 * The two system-seeded sets ("All puzzles" and "Woodpecker random") and their
 * deterministic per-cycle membership derivation. Membership is **virtual**: a
 * pure function of the recipe, the current puzzle pool, the derived mastery and
 * the set's deterministic seed (its id). It is re-derived at each cycle start
 * and snapshotted onto the cycle, never mutated mid-cycle (spec §3a).
 *
 * `woodpeckerRandom` ranks each eligible puzzle by a stable, dependency-free
 * FNV-1a hash of `setId + "\u0000" + puzzleId` and takes the lowest `size`
 * (ties by puzzle id), so a fixed eligible pool always yields the same subset;
 * mastered departures are backfilled deterministically. No `Math.random`, no
 * hidden clock, no new dependency. No React, Dexie, engine or network import.
 */

import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { DEFAULT_CYCLE_CONFIG, type AutoSetRecipe, type CycleConfig } from './cycleTypes';
import { orderPuzzles } from './set';

/** Deterministic id of the "All puzzles" auto set (the membership seed). */
export const AUTO_SET_ALL_ID = 'auto:all-puzzles';

/** Deterministic id of the "Woodpecker random" auto set (the membership seed). */
export const AUTO_SET_RANDOM_ID = 'auto:woodpecker-random';

/** V1 size cap of the `woodpeckerRandom` recipe (`domain/tactical-training.md`). */
export const WOODPECKER_RANDOM_SIZE = 200;

/**
 * Version of the auto-set recipes/selection semantics (size, hash, ordering).
 * A change to a recipe's semantics is a new recipe, not a silent mutation of
 * stored rows (Feature 013 §12).
 */
export const AUTO_SET_VERSION = 1;

/** A seeded auto-set definition: deterministic id, display name, recipe, config. */
export interface AutoSetDefinition {
  readonly id: string;
  readonly name: string;
  readonly recipe: AutoSetRecipe;
  /** Fixed preset config (goal accuracy 100%, hints enabled, `endOfCycle`). */
  readonly config: CycleConfig;
}

/** The fixed auto-set preset config, deep-cloned so callers cannot alias it. */
function autoSetConfig(): CycleConfig {
  return {
    ...DEFAULT_CYCLE_CONFIG,
    targetAccuracy: 1,
    hints: {
      ...DEFAULT_CYCLE_CONFIG.hints,
      enabledLevels: [...DEFAULT_CYCLE_CONFIG.hints.enabledLevels],
    },
  };
}

/**
 * The two system-seeded auto-set definitions, in deterministic order ("All
 * puzzles" then "Woodpecker random"). A fresh array/config is returned each
 * call, so callers can neither mutate shared state nor alias the preset.
 */
export function autoSetDefinitions(): readonly AutoSetDefinition[] {
  return [
    {
      id: AUTO_SET_ALL_ID,
      name: 'All puzzles',
      recipe: { kind: 'allPuzzles' },
      config: autoSetConfig(),
    },
    {
      id: AUTO_SET_RANDOM_ID,
      name: 'Woodpecker random',
      recipe: { kind: 'woodpeckerRandom', size: WOODPECKER_RANDOM_SIZE },
      config: autoSetConfig(),
    },
  ];
}

/** Inputs to `deriveAutoSetMembership`. */
export interface DeriveAutoSetMembershipInput {
  /** The auto-set recipe (selection rule). */
  readonly recipe: AutoSetRecipe;
  /** The current puzzle pool (every persisted `PuzzleRow`). */
  readonly pool: readonly PuzzleRow[];
  /** Puzzle ids already mastered; excluded from the eligible pool. */
  readonly masteredIds: ReadonlySet<string>;
  /** The set's deterministic seed (its id). */
  readonly setId: string;
}

/**
 * Derive an auto set's ordered membership ids.
 *
 * Filters the pool to unmastered puzzles, applies the recipe's selection (all
 * eligible for `allPuzzles`; the lowest-`size` by stable hash for
 * `woodpeckerRandom`), then orders the selection by difficulty ascending with
 * ties by puzzle id. Deterministic and input-non-mutating; an empty or
 * fully-mastered pool yields an empty result.
 */
export function deriveAutoSetMembership(input: DeriveAutoSetMembershipInput): string[] {
  const eligible = eligibleRows(input.pool, input.masteredIds);
  const selected =
    input.recipe.kind === 'allPuzzles'
      ? eligible
      : selectLowestPriority(eligible, input.recipe.size, input.setId);
  return orderPuzzles(selected, 'difficultyAsc').map((row) =>
    puzzleIdOf(row.sourceGameId, row.sourcePly),
  );
}

/**
 * The unmastered pool rows, deduplicated by canonical puzzle id (first
 * occurrence wins) so membership ids are unique even for malformed input.
 */
function eligibleRows(pool: readonly PuzzleRow[], masteredIds: ReadonlySet<string>): PuzzleRow[] {
  const byId = new Map<string, PuzzleRow>();
  for (const row of pool) {
    const id = puzzleIdOf(row.sourceGameId, row.sourcePly);
    if (masteredIds.has(id) || byId.has(id)) {
      continue;
    }
    byId.set(id, row);
  }
  return [...byId.values()];
}

/**
 * Select the lowest-priority `size` rows by `stableHash(setId + "\0" + id)`,
 * ties by puzzle id ascending. When the eligible pool is at or below `size`,
 * every row is returned (the deterministic backfill).
 */
function selectLowestPriority(
  rows: readonly PuzzleRow[],
  size: number,
  setId: string,
): PuzzleRow[] {
  const cap = Math.max(0, Math.trunc(size));
  if (cap === 0) {
    return [];
  }
  if (rows.length <= cap) {
    return [...rows];
  }
  const ranked = rows.map((row) => {
    const id = puzzleIdOf(row.sourceGameId, row.sourcePly);
    return { row, id, priority: stableHash(`${setId}\u0000${id}`) };
  });
  ranked.sort((a, b) =>
    a.priority === b.priority ? compareIds(a.id, b.id) : a.priority - b.priority,
  );
  return ranked.slice(0, cap).map((entry) => entry.row);
}

/** Stable, dependency-free 32-bit FNV-1a hash of a string. */
function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic string comparison used as the puzzle-id tie-break. */
function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
