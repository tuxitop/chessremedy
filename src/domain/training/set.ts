/**
 * Feature 013 — set membership resolution and ordering (domain, pure).
 *
 * Resolution is a pure function of the persisted puzzle rows, the optional
 * pool enrichment and the config: it resolves the candidate universe **once**,
 * orders it deterministically and takes at most `targetSize` puzzles, returning
 * canonical `puzzleIdOf` ids. The result is stored on the set — it is never a
 * live query. A source that resolves nothing yields an empty membership (never
 * an error); a missing puzzle row simply cannot be selected.
 */

import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import { difficultyBucketOf, type DifficultyBucketName } from '@/domain/puzzle/buckets';
import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleOrigin, PuzzleRow } from '@/domain/puzzle/types';
import type { OrderingPolicy, PuzzlePoolEntry, PuzzlePoolFilters, SetSource } from './cycleTypes';

/**
 * Order a puzzle list under an `OrderingPolicy`. Pure and total; every policy
 * is deterministic.
 *
 * - `difficultyAsc` — difficulty ascending, ties by puzzle id ascending;
 * - `sourcePly` — `sourceGameId` ascending, then `sourcePly` ascending;
 * - `manual` — the provided base order is preserved.
 *
 * Ties are always broken by puzzle id so the result is stable regardless of
 * input order.
 */
export function orderPuzzles(puzzles: readonly PuzzleRow[], ordering: OrderingPolicy): PuzzleRow[] {
  const copy = [...puzzles];
  if (ordering === 'manual') {
    return copy;
  }
  if (ordering === 'sourcePly') {
    return copy.sort((a, b) => {
      if (a.sourceGameId !== b.sourceGameId) {
        return a.sourceGameId < b.sourceGameId ? -1 : 1;
      }
      if (a.sourcePly !== b.sourcePly) {
        return a.sourcePly - b.sourcePly;
      }
      return comparePuzzleIds(a, b);
    });
  }
  return copy.sort((a, b) => {
    if (a.difficulty !== b.difficulty) {
      return a.difficulty - b.difficulty;
    }
    return comparePuzzleIds(a, b);
  });
}

/** Canonical id comparison used as the deterministic tie-break. */
function comparePuzzleIds(a: PuzzleRow, b: PuzzleRow): number {
  const idA = puzzleIdOf(a.sourceGameId, a.sourcePly);
  const idB = puzzleIdOf(b.sourceGameId, b.sourcePly);
  if (idA === idB) {
    return 0;
  }
  return idA < idB ? -1 : 1;
}

/** Inputs to `resolveSetMembership`. */
export interface ResolveSetMembershipInput {
  /** Provenance of the membership being resolved. */
  readonly source: SetSource;
  /** The candidate puzzle universe (e.g. a game's rows, or all persisted rows). */
  readonly puzzles: readonly PuzzleRow[];
  /** Pool enrichment, required only for a `pool` source. */
  readonly poolEntries?: readonly PuzzlePoolEntry[];
  /** Manual selection order, required only for a `manual` source. */
  readonly manualIds?: readonly string[];
  /** Ordering policy applied after the source universe is resolved. */
  readonly ordering: OrderingPolicy;
  /** Creation target/cap; the first N under the ordering are taken. */
  readonly targetSize: number;
  /** Optional origin filter applied to the resolved universe. */
  readonly originFilter?: PuzzleOrigin;
  /** Optional difficulty-bucket filter applied to the resolved universe. */
  readonly difficultyFilter?: DifficultyBucketName;
}

/**
 * Resolve a set's membership ids from a source.
 *
 * The source universe is built in its deterministic base order (R-3): a game
 * source is ordered by `sourcePly`, a pool source by puzzle id ascending, and a
 * manual source keeps the caller's selection order. The explicit
 * `originFilter`/`difficultyFilter` are applied to that universe, then
 * `orderPuzzles` applies the configured policy and at most `targetSize` ids are
 * returned. A missing manual id is dropped rather than fabricated.
 */
export function resolveSetMembership(input: ResolveSetMembershipInput): string[] {
  const { ordering, targetSize } = input;
  const candidates = baseCandidates(input);
  const filtered = candidates.filter((puzzle) => matchesFilters(puzzle, input));
  const ordered = orderPuzzles(filtered, ordering);
  const cap = Math.max(0, Math.trunc(targetSize));
  return ordered.slice(0, cap).map((puzzle) => puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly));
}

/** Build the source universe in its deterministic base order (R-3). */
function baseCandidates(input: ResolveSetMembershipInput): PuzzleRow[] {
  const { source, puzzles, poolEntries, manualIds } = input;
  if (source.kind === 'manual') {
    const byId = new Map(
      puzzles.map((puzzle) => [puzzleIdOf(puzzle.sourceGameId, puzzle.sourcePly), puzzle]),
    );
    return (manualIds ?? []).flatMap((id) => {
      const puzzle = byId.get(id);
      return puzzle === undefined ? [] : [puzzle];
    });
  }
  if (source.kind === 'pool') {
    return (poolEntries ?? [])
      .filter((entry) => matchesPoolFilters(entry, source.filters))
      .map((entry) => entry.puzzle)
      .sort((a, b) => comparePuzzleIds(a, b));
  }
  return [...puzzles].sort((a, b) => {
    if (a.sourceGameId !== b.sourceGameId) {
      return a.sourceGameId < b.sourceGameId ? -1 : 1;
    }
    return a.sourcePly - b.sourcePly;
  });
}

/** Apply the explicit origin/difficulty filters (absent origin = tactical). */
function matchesFilters(puzzle: PuzzleRow, input: ResolveSetMembershipInput): boolean {
  if (input.originFilter !== undefined && (puzzle.origin ?? 'tactical') !== input.originFilter) {
    return false;
  }
  if (
    input.difficultyFilter !== undefined &&
    difficultyBucketOf(puzzle.difficulty).name !== input.difficultyFilter
  ) {
    return false;
  }
  return true;
}

/** Apply the pool filters to an enriched entry (absent origin = tactical). */
function matchesPoolFilters(entry: PuzzlePoolEntry, filters: PuzzlePoolFilters): boolean {
  const puzzle = entry.puzzle;
  if (filters.origin !== undefined && (puzzle.origin ?? 'tactical') !== filters.origin) {
    return false;
  }
  if (
    filters.tacticalObjective !== undefined &&
    puzzle.tacticalObjective !== filters.tacticalObjective
  ) {
    return false;
  }
  if (
    filters.difficultyBucket !== undefined &&
    difficultyBucketOf(puzzle.difficulty).name !== filters.difficultyBucket
  ) {
    return false;
  }
  if (filters.sourceGameId !== undefined && puzzle.sourceGameId !== filters.sourceGameId) {
    return false;
  }
  if (filters.platform !== undefined && entry.platform !== filters.platform) {
    return false;
  }
  if (
    filters.timeControlCategory !== undefined &&
    entry.timeControlCategory !== filters.timeControlCategory
  ) {
    return false;
  }
  return true;
}

/**
 * A human-readable provenance descriptor for a set's source. Deterministic and
 * locale-independent; used only for display (the authoritative membership is
 * the stored `puzzleIds`).
 */
export function setSourceLabel(source: SetSource): string {
  if (source.kind === 'manual') {
    return 'Manual selection';
  }
  if (source.kind === 'game') {
    return `Game ${source.gameId}`;
  }
  const parts = poolFilterLabels(source.filters);
  return parts.length === 0 ? 'Puzzle pool' : `Puzzle pool (${parts.join(', ')})`;
}

/** Human-readable labels for the non-empty pool filters, in a fixed order. */
function poolFilterLabels(filters: PuzzlePoolFilters): string[] {
  const parts: string[] = [];
  if (filters.origin !== undefined) {
    parts.push(`origin: ${filters.origin}`);
  }
  if (filters.tacticalObjective !== undefined) {
    parts.push(`objective: ${filters.tacticalObjective}`);
  }
  if (filters.difficultyBucket !== undefined) {
    parts.push(`difficulty: ${filters.difficultyBucket}`);
  }
  if (filters.sourceGameId !== undefined) {
    parts.push(`game: ${filters.sourceGameId}`);
  }
  if (filters.platform !== undefined) {
    parts.push(`platform: ${GAME_SOURCE_LABELS[filters.platform]}`);
  }
  if (filters.timeControlCategory !== undefined) {
    parts.push(`time control: ${filters.timeControlCategory}`);
  }
  return parts;
}
