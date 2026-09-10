/**
 * Feature 013 — Woodpecker block formation and the derived pool (domain, pure).
 *
 * The app never forms a block on its own: a **Woodpecker block** is an explicit
 * one-click, fixed snapshot of the derived **pool** (spec §1/§3/§3a). This
 * module owns the two pure derivations behind that action:
 *
 * - `derivePool` — owned puzzles minus the derived mastery set minus the
 *   currently-open block's members (the unmastered, not-in-open-block pool);
 * - `formWoodpeckerBlock` — the easiest-`size` pool puzzles in `difficultyAsc`
 *   order (ties by `sourcePly`, then `puzzleId`), the frozen membership snapshot
 *   the caller stores.
 *
 * Membership is a **snapshot**: it is resolved once at creation and never
 * re-derived per cycle (this supersedes the former virtual/per-cycle membership).
 * Everything here is deterministic and input-non-mutating: no `Math.random`, no
 * hidden clock, no scheduler state, no new dependency. No React, Dexie, engine
 * or network import (ADR-031).
 */

import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';

/** Default one-click Woodpecker block size (`domain/tactical-training.md`). */
export const DEFAULT_BLOCK_SIZE = 200;

/** The block sizes offered behind the "Advanced" disclosure (default first). */
export const BLOCK_SIZE_OPTIONS = [100, 200, 400] as const;

/**
 * Below this size later cycles risk memorising diagrams rather than training
 * recognition. **Guidance only** — never a gate (spec §3a).
 */
export const RECOMMENDED_MIN_BLOCK_SIZE = 100;

/** Suggested number of cycles for a Woodpecker plan. **Guidance only.** */
export const WOODPECKER_PLAN_CYCLES = 6;

/**
 * Reserved ad-hoc `trainingSetId` sentinel for a Quick-train cycle. Quick train
 * creates no `trainingSets` row and writes its attempts under this sentinel so
 * every attempt keeps a real `cycleId`/`trainingSetId` (spec §3c).
 */
export const QUICK_TRAIN_SET_ID = '__quick_train__';

/**
 * Version of the block recipe/formation semantics (size, ordering, tie-break).
 * A change to a recipe's semantics is a new recipe, not a silent mutation of
 * stored rows (Feature 013 §12).
 */
export const BLOCK_RECIPE_VERSION = 1;

/** Inputs to `derivePool`. */
export interface DerivePoolInput {
  /** Every owned puzzle row. */
  readonly puzzles: readonly PuzzleRow[];
  /** Puzzle ids already mastered; excluded from the pool. */
  readonly masteredIds: ReadonlySet<string>;
  /** Members of the currently-open block; excluded from the pool. */
  readonly openBlockPuzzleIds: ReadonlySet<string>;
}

/**
 * Derive the training **pool**: every owned puzzle that is neither mastered nor
 * a member of the currently-open block (spec §1/§3). The pool is a read-time
 * view — it is never stored as a set. Deduplicated by canonical puzzle id
 * (first occurrence wins) so membership ids stay unique even for malformed
 * input. Deterministic, pure and input-non-mutating.
 */
export function derivePool(input: DerivePoolInput): PuzzleRow[] {
  const byId = new Map<string, PuzzleRow>();
  for (const row of input.puzzles) {
    const id = puzzleIdOf(row.sourceGameId, row.sourcePly);
    if (input.masteredIds.has(id) || input.openBlockPuzzleIds.has(id) || byId.has(id)) {
      continue;
    }
    byId.set(id, row);
  }
  return [...byId.values()];
}

/** Inputs to `formWoodpeckerBlock`. */
export interface FormWoodpeckerBlockInput {
  /** The candidate pool rows (usually `derivePool(...)`). */
  readonly pool: readonly PuzzleRow[];
  /**
   * Puzzle ids already mastered. Excluded defensively even when the caller
   * already removed them from `pool`.
   */
  readonly masteredIds: ReadonlySet<string>;
  /**
   * Requested cap (`100 | 200 | 400`, default `DEFAULT_BLOCK_SIZE`). When the
   * pool is smaller, the block takes all of it.
   */
  readonly size: number;
}

/**
 * Form a Woodpecker block's frozen membership ids: the easiest-`size` pool
 * puzzles in `difficultyAsc` order, ties by `sourcePly` then `puzzleId`
 * (spec §3a). Mastered puzzles are excluded defensively. When the pool is
 * smaller than `size` the block takes all of it (never padded or fabricated);
 * an empty pool yields an empty selection (the caller blocks creation).
 * Deterministic and input-non-mutating.
 */
export function formWoodpeckerBlock(input: FormWoodpeckerBlockInput): string[] {
  const byId = new Map<string, PuzzleRow>();
  for (const row of input.pool) {
    const id = puzzleIdOf(row.sourceGameId, row.sourcePly);
    if (input.masteredIds.has(id) || byId.has(id)) {
      continue;
    }
    byId.set(id, row);
  }
  const ordered = [...byId.values()].sort(compareBlockOrder);
  const cap = Math.max(0, Math.trunc(input.size));
  return ordered.slice(0, cap).map((row) => puzzleIdOf(row.sourceGameId, row.sourcePly));
}

/**
 * Block ordering: difficulty ascending, ties by `sourcePly` ascending, then
 * canonical `puzzleId` ascending (spec §3a). Total and deterministic.
 */
function compareBlockOrder(a: PuzzleRow, b: PuzzleRow): number {
  if (a.difficulty !== b.difficulty) {
    return a.difficulty - b.difficulty;
  }
  if (a.sourcePly !== b.sourcePly) {
    return a.sourcePly - b.sourcePly;
  }
  const idA = puzzleIdOf(a.sourceGameId, a.sourcePly);
  const idB = puzzleIdOf(b.sourceGameId, b.sourcePly);
  if (idA === idB) {
    return 0;
  }
  return idA < idB ? -1 : 1;
}
