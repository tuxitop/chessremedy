/**
 * Feature 013 — training-session timing and summary (domain, pure).
 *
 * A training session is a bounded solving run: an optional wall-clock limit
 * (`durationMs: null` = "No time limit") with a warning threshold, and a summary
 * of the attempts made. Both the timer state and the summary are pure and
 * derived from caller-injected inputs (a `now`, the attempts) — no clock, React,
 * Dexie or engine is read here.
 *
 * `summarizeSession` never re-implements the canonical cycle math: it delegates
 * the aggregate figures to `computeCycleMetrics` and the per-puzzle outcome
 * counts to `resolvePuzzleCycle`, so the session summary can never drift from
 * the cycle metrics (Feature 013/014 §8).
 */

import { resolvePuzzleCycle } from './cycle';
import { computeCycleMetrics } from './cycleMetrics';
import type { PuzzleAttemptRow } from './types';

/** Default session duration: ten minutes. */
export const DEFAULT_SESSION_DURATION_MS = 10 * 60_000;

/** The selectable session durations, in millis (5, 10, 15, 20, 30, 45, 60 min). */
export const SESSION_DURATION_OPTIONS_MS: readonly number[] = [5, 10, 15, 20, 30, 45, 60].map(
  (minutes) => minutes * 60_000,
);

/** Default time remaining at which the session timer warns. */
export const DEFAULT_SESSION_WARNING_MS = 30_000;

/** Default per-puzzle "red" threshold: a puzzle exceeding this is flagged. */
export const DEFAULT_PUZZLE_RED_MS = 30_000;

/**
 * A session's timing configuration. `durationMs: null` means the session is
 * untimed; `warningMs` is the remaining-time threshold that raises the warning
 * flag (ignored when untimed).
 */
export interface SessionConfig {
  readonly durationMs: number | null;
  readonly warningMs: number;
}

/** The derived state of a session timer at an instant. */
export interface SessionTimerState {
  /** Time until `endsAt`, clamped at `0`; `null` when the session is untimed. */
  readonly remainingMs: number | null;
  /** True once `now` reaches or passes `endsAt` (never for an untimed session). */
  readonly expired: boolean;
  /** True when the remaining time is at or below `warningMs` but not expired. */
  readonly warning: boolean;
}

/** A session's attempt summary, derived from its immutable attempt rows. */
export interface SessionSummary {
  /** Distinct puzzles with at least one attempt row. */
  readonly puzzlesAttempted: number;
  /** Puzzles whose first presentation was a clean `solvedFirstTry`. */
  readonly solvedFirstTry: number;
  /** Puzzles eventually solved but not on a clean first try. */
  readonly solvedWithHelp: number;
  /** Puzzles whose only definite outcome was `failed`. */
  readonly failed: number;
  /** Puzzles whose only outcome was `skipped`. */
  readonly skipped: number;
  /** Puzzles with at least one definite presentation. */
  readonly completed: number;
  /** `solvedFirstTry / completed`, or `null` when nothing is completed. */
  readonly firstTryAccuracy: number | null;
  /** Σ `solvingTimeMs` over completed puzzles. */
  readonly totalTimeMs: number;
  /** `totalTimeMs / completed`, or `null` when nothing is completed. */
  readonly averageTimeMs: number | null;
  /** Median per-completed-puzzle solving time, or `null` when none. */
  readonly medianTimeMs: number | null;
}

/** Inputs to `sessionTimerState`. */
export interface SessionTimerInput {
  /** The current instant, Unix epoch millis (caller-injected). */
  readonly now: number;
  /** The session end instant, or `null` for an untimed session. */
  readonly endsAt: number | null;
  /** The remaining-time warning threshold in millis. */
  readonly warningMs: number;
}

/**
 * Derive the timer state for an instant. An untimed session (`endsAt: null`)
 * reports no remaining time and never expires or warns; otherwise the remaining
 * time is clamped at zero, `expired` is exact at the boundary, and `warning` is
 * true only while time remains and is at or below `warningMs`.
 */
export function sessionTimerState(input: SessionTimerInput): SessionTimerState {
  if (input.endsAt === null) {
    return { remainingMs: null, expired: false, warning: false };
  }
  const remainingMs = Math.max(0, input.endsAt - input.now);
  const expired = remainingMs === 0;
  return { remainingMs, expired, warning: !expired && remainingMs <= input.warningMs };
}

/**
 * Summarize a session's attempt rows. The aggregate figures come from the
 * canonical `computeCycleMetrics` over the distinct puzzle ids; the outcome
 * counts come from `resolvePuzzleCycle` per puzzle. An empty session reports
 * zero counts, `null` rates and `0`/`null` times — never a fabricated value.
 */
export function summarizeSession(attempts: readonly PuzzleAttemptRow[]): SessionSummary {
  const puzzleIds = distinctPuzzleIds(attempts);
  const metrics = computeCycleMetrics({ puzzleIds, attempts });
  const grouped = groupAttempts(attempts);
  let solvedFirstTry = 0;
  let solvedWithHelp = 0;
  let failed = 0;
  let skipped = 0;
  for (const puzzleId of puzzleIds) {
    const resolution = resolvePuzzleCycle(puzzleId, grouped.get(puzzleId) ?? []);
    if (resolution.firstTrySolved) {
      solvedFirstTry += 1;
    } else if (resolution.eventuallySolved) {
      solvedWithHelp += 1;
    }
    if (resolution.skipped) {
      skipped += 1;
    }
    if (resolution.definite && !resolution.eventuallySolved && !resolution.skipped) {
      failed += 1;
    }
  }
  return {
    puzzlesAttempted: metrics.puzzlesAttempted,
    solvedFirstTry,
    solvedWithHelp,
    failed,
    skipped,
    completed: metrics.puzzlesCompleted,
    firstTryAccuracy: metrics.firstTryAccuracy,
    totalTimeMs: metrics.solvingTime.totalMs,
    averageTimeMs: metrics.solvingTime.averageMs,
    medianTimeMs: metrics.solvingTime.medianMs,
  };
}

/** The distinct puzzle ids in first-seen order. */
function distinctPuzzleIds(attempts: readonly PuzzleAttemptRow[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of attempts) {
    if (!seen.has(row.puzzleId)) {
      seen.add(row.puzzleId);
      ids.push(row.puzzleId);
    }
  }
  return ids;
}

/** Group attempt rows by puzzle id, preserving input order within a puzzle. */
function groupAttempts(attempts: readonly PuzzleAttemptRow[]): Map<string, PuzzleAttemptRow[]> {
  const grouped = new Map<string, PuzzleAttemptRow[]>();
  for (const row of attempts) {
    const bucket = grouped.get(row.puzzleId);
    if (bucket === undefined) {
      grouped.set(row.puzzleId, [row]);
    } else {
      bucket.push(row);
    }
  }
  return grouped;
}
