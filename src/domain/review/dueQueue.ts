/**
 * Feature 020 — deterministic due-queue builder (pure).
 *
 * Builds the ordered review-session snapshot: due reviews (ordered by `dueAt`,
 * ties by puzzle difficulty then id) then new intake from the canonical
 * `derivePool` result (difficulty ascending, ties by `sourcePly` then id),
 * each bounded by the remaining per-local-day allowance. `normalizeCaps`
 * validates the stored caps (fallback/clamp/`0`-pause).
 */

import { puzzleIdOf } from '@/domain/puzzle/id';
import type { PuzzleRow } from '@/domain/puzzle/types';
import {
  DEFAULT_DAILY_NEW_CAP,
  DEFAULT_DAILY_REVIEW_CAP,
  MAX_DAILY_NEW_CAP,
  MAX_DAILY_REVIEW_CAP,
} from './constants';
import type { DayUsage, ReviewCaps, ReviewQueueEntry } from './types';

/** The untyped stored cap values `normalizeCaps` accepts. */
export interface RawReviewCaps {
  readonly newCap?: unknown;
  readonly reviewCap?: unknown;
}

/**
 * Normalize the stored daily caps: an absent/non-finite value falls back to
 * its default, a negative value becomes `0` (paused), and a value above the
 * documented safety maximum is clamped. `0` is valid.
 */
export function normalizeCaps(raw: RawReviewCaps): ReviewCaps {
  return {
    newCap: normalizeCap(raw.newCap, DEFAULT_DAILY_NEW_CAP, MAX_DAILY_NEW_CAP),
    reviewCap: normalizeCap(raw.reviewCap, DEFAULT_DAILY_REVIEW_CAP, MAX_DAILY_REVIEW_CAP),
  };
}

function normalizeCap(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < 0) {
    return 0;
  }
  return Math.min(maximum, Math.trunc(value));
}

/** The minimal schedule shape the due-queue builder reads. */
export interface DueSchedule {
  readonly puzzleId: string;
  readonly dueAt: number;
}

/** Inputs to `dueQueue`. */
export interface DueQueueInput {
  /** Current `puzzleSchedules` rows (any order). */
  readonly schedules: readonly DueSchedule[];
  /** Every owned puzzle row (difficulty lookup for due-review ordering). */
  readonly puzzles: readonly PuzzleRow[];
  /** The canonical `derivePool` result (new-intake candidates). */
  readonly pool: readonly PuzzleRow[];
  /** Current instant, Unix epoch millis. */
  readonly now: number;
  /** Normalized caps in force. */
  readonly caps: ReviewCaps;
  /** Today's already-consumed allowances. */
  readonly dayUsage: DayUsage;
  /** Gradeable puzzles awaiting a lazy rebuild; excluded from intake. */
  readonly pendingRebuildIds: ReadonlySet<string>;
}

/**
 * Build the ordered snapshot. Mastery/open-block exclusion is inherited from
 * `derivePool`; a mastered puzzle with a due row is still reviewed.
 */
export function dueQueue(input: DueQueueInput): ReviewQueueEntry[] {
  const difficultyById = new Map<string, number>();
  for (const row of input.puzzles) {
    difficultyById.set(puzzleIdOf(row.sourceGameId, row.sourcePly), row.difficulty);
  }
  const scheduledIds = new Set(input.schedules.map((row) => row.puzzleId));

  const reviewAllowance = Math.max(0, input.caps.reviewCap - input.dayUsage.reviewCount);
  const reviews = input.schedules
    .filter((row) => row.dueAt <= input.now)
    .sort(
      (a, b) =>
        a.dueAt - b.dueAt ||
        difficultyOf(difficultyById, a.puzzleId) - difficultyOf(difficultyById, b.puzzleId) ||
        a.puzzleId.localeCompare(b.puzzleId),
    )
    .slice(0, reviewAllowance)
    .map((row): ReviewQueueEntry => ({
      puzzleId: row.puzzleId,
      kind: 'review',
      dueAt: row.dueAt,
    }));

  const newAllowance = Math.max(0, input.caps.newCap - input.dayUsage.newCount);
  const seen = new Set<string>();
  const intake: ReviewQueueEntry[] = [];
  for (const row of [...input.pool].sort(compareIntake)) {
    const id = puzzleIdOf(row.sourceGameId, row.sourcePly);
    if (seen.has(id) || scheduledIds.has(id) || input.pendingRebuildIds.has(id)) {
      continue;
    }
    seen.add(id);
    intake.push({ puzzleId: id, kind: 'new', dueAt: null });
  }

  return [...reviews, ...intake.slice(0, newAllowance)];
}

/** Unknown-difficulty schedules sort after known ones. */
function difficultyOf(byId: ReadonlyMap<string, number>, puzzleId: string): number {
  return byId.get(puzzleId) ?? Number.POSITIVE_INFINITY;
}

/** New-intake ordering: difficulty ascending, ties by `sourcePly` then id. */
function compareIntake(a: PuzzleRow, b: PuzzleRow): number {
  if (a.difficulty !== b.difficulty) {
    return a.difficulty - b.difficulty;
  }
  if (a.sourcePly !== b.sourcePly) {
    return a.sourcePly - b.sourcePly;
  }
  return puzzleIdOf(a.sourceGameId, a.sourcePly).localeCompare(
    puzzleIdOf(b.sourceGameId, b.sourcePly),
  );
}
