/**
 * Feature 013 — training-cycle lifecycle (domain, pure).
 *
 * The deterministic heart of the cycle model: 1-based numbering, the immutable
 * cycle snapshot, the per-puzzle resolution, terminal/completion predicates,
 * derived resume reconstruction (no stored cursor) and config validation. Every
 * function is pure and synchronous over already-loaded rows; no clock, React,
 * Dexie or engine is read here (the caller injects `now` and ids).
 *
 * The retry pass is **bounded**: a puzzle is presented at most twice per cycle
 * (first pass plus at most one retry), driven by the stored `failed` result, so
 * a cycle always terminates and resume is idempotent.
 */

import type { SolveHintConfig } from './types';
import type { PuzzleAttemptRow, TrainingResult } from './types';
import {
  CYCLE_CONFIG_VERSION,
  CYCLE_METRICS_VERSION,
  type CycleConfig,
  type HintConfig,
  type OrderingPolicy,
  type RetryFailed,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
} from './cycleTypes';

/**
 * The per-puzzle resolution of a cycle, reconciling Feature 012's
 * one-row-per-presentation storage with the domain's per-puzzle metrics
 * (Feature 014 §8). `presentations` is ordered by `presentationIndex`.
 */
export interface CycleResolution {
  /** Canonical puzzle id (`puzzleIdOf`). */
  readonly puzzleId: string;
  /** The attempt rows for this puzzle, ordered by `presentationIndex`. */
  readonly presentations: readonly PuzzleAttemptRow[];
  /** Number of presentations (0 when the puzzle is still pending). */
  readonly presentationCount: number;
  /** True when the puzzle has rows and every one is `skipped`. */
  readonly skipped: boolean;
  /** True when at least one presentation has a non-`skipped` result. */
  readonly definite: boolean;
  /** True when the first presentation's result is `solvedFirstTry`. */
  readonly firstTrySolved: boolean;
  /** True when any presentation solved (`solvedFirstTry`/`solvedWithHelp`). */
  readonly eventuallySolved: boolean;
  /** Last definite presentation's result, or `skipped` when none. */
  readonly lastResult: TrainingResult;
  /** Σ `wrongMoveCount` over all presentations. */
  readonly wrongMoves: number;
  /** Σ `hintCount` over all presentations. */
  readonly hints: number;
  /** Σ `solvingTimeMs` over definite presentations. */
  readonly solvingTimeMs: number;
}

/** One pending presentation in a reconstructed resume queue. */
export interface ResumeEntry {
  readonly puzzleId: string;
  /** 1 for a first-pass presentation, 2 for a bounded retry. */
  readonly presentationIndex: number;
}

/** The ordered pending presentations of a cycle, derived from stored rows. */
export type ResumeQueue = readonly ResumeEntry[];

/** Inputs to `isCycleComplete` / `reconstructResume`. */
export interface CycleProgressInput {
  /** The cycle's ordered snapshot membership. */
  readonly puzzleIds: readonly string[];
  /** The cycle's persisted attempt rows (any order). */
  readonly attempts: readonly PuzzleAttemptRow[];
  readonly retryFailed: RetryFailed;
  /** Snapshot puzzle ids whose row no longer exists (terminal, never queued). */
  readonly missingPuzzleIds?: ReadonlySet<string>;
}

/** Inputs to `snapshotCycle`. */
export interface SnapshotCycleInput {
  /** New cycle id (caller-injected for determinism). */
  readonly id: string;
  /** The set the cycle is started from. */
  readonly set: TacticalTrainingSetRow;
  /** The next 1-based cycle number for the set. */
  readonly cycleNumber: number;
  /** Ordered membership to snapshot (usually the set's `puzzleIds`). */
  readonly puzzleIds: readonly string[];
  /** Config to snapshot (usually the set's current `config`). */
  readonly config: CycleConfig;
  /** Cycle start, Unix epoch millis (caller-injected). */
  readonly now: number;
}

/**
 * The next 1-based cycle number for a set: `max(existing) + 1`, or 1 when the
 * set has no cycles yet. Ignores non-positive values.
 */
export function nextCycleNumber(existingNumbers: readonly number[]): number {
  let max = 0;
  for (const value of existingNumbers) {
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max + 1;
}

/**
 * Build the immutable cycle snapshot: status `inProgress`, null completion
 * timestamps, the current metrics version, and deep copies of the membership
 * and config so later mutation of the inputs cannot alter the stored snapshot.
 */
export function snapshotCycle(input: SnapshotCycleInput): TrainingCycleRow {
  return {
    id: input.id,
    trainingSetId: input.set.id,
    cycleNumber: input.cycleNumber,
    status: 'inProgress',
    startedAt: input.now,
    updatedAt: input.now,
    completedAt: null,
    abandonedAt: null,
    puzzleIds: [...input.puzzleIds],
    config: cloneCycleConfig(input.config),
    cycleMetricsVersion: CYCLE_METRICS_VERSION,
  };
}

/** Deep-copy a config so a snapshot cannot alias a mutable caller object. */
function cloneCycleConfig(config: CycleConfig): CycleConfig {
  return {
    ...config,
    hints: {
      ...config.hints,
      enabledLevels: [...config.hints.enabledLevels],
    },
  };
}

/**
 * Resolve one puzzle's cycle outcome from its attempt rows. Rows are ordered by
 * `presentationIndex`; the empty case yields an unresolved (pending)
 * resolution.
 */
export function resolvePuzzleCycle(
  puzzleId: string,
  attempts: readonly PuzzleAttemptRow[],
): CycleResolution {
  const presentations = [...attempts].sort((a, b) => a.presentationIndex - b.presentationIndex);
  const presentationCount = presentations.length;
  const definitePresentations = presentations.filter((row) => row.result !== 'skipped');
  let wrongMoves = 0;
  let hints = 0;
  let solvingTimeMs = 0;
  for (const row of presentations) {
    wrongMoves += row.wrongMoveCount;
    hints += row.hintCount;
    if (row.result !== 'skipped') {
      solvingTimeMs += row.solvingTimeMs;
    }
  }
  const lastDefinite = definitePresentations[definitePresentations.length - 1];
  return {
    puzzleId,
    presentations,
    presentationCount,
    skipped: presentationCount > 0 && definitePresentations.length === 0,
    definite: definitePresentations.length > 0,
    firstTrySolved: presentations[0]?.result === 'solvedFirstTry',
    eventuallySolved: presentations.some(
      (row) => row.result === 'solvedFirstTry' || row.result === 'solvedWithHelp',
    ),
    lastResult: lastDefinite?.result ?? 'skipped',
    wrongMoves,
    hints,
    solvingTimeMs,
  };
}

/**
 * Whether a puzzle is terminal in a cycle: solved, skipped, or having reached
 * the allowed presentation count under `retryFailed` (`1` for `none`, `2` for
 * `immediate`/`endOfCycle`) without solving. A puzzle with no presentations is
 * never terminal — it is still pending.
 */
export function isPuzzleTerminal(resolution: CycleResolution, retryFailed: RetryFailed): boolean {
  if (resolution.presentationCount === 0) {
    return false;
  }
  if (resolution.eventuallySolved || resolution.skipped) {
    return true;
  }
  if (retryFailed === 'none') {
    return true;
  }
  return resolution.presentationCount >= 2;
}

/**
 * Whether a cycle is complete: every snapshot puzzle is terminal, or its row no
 * longer exists (`missingPuzzleIds`). Skipped and missing puzzles do not block
 * completion but are not counted as completed.
 */
export function isCycleComplete(input: CycleProgressInput): boolean {
  const grouped = groupAttempts(input.attempts);
  const missing = input.missingPuzzleIds;
  for (const puzzleId of input.puzzleIds) {
    if (missing?.has(puzzleId)) {
      continue;
    }
    const resolution = resolvePuzzleCycle(puzzleId, grouped.get(puzzleId) ?? []);
    if (!isPuzzleTerminal(resolution, input.retryFailed)) {
      return false;
    }
  }
  return true;
}

/**
 * Reconstruct the ordered pending presentations of a cycle from its persisted
 * rows, with no stored cursor (spec §7).
 *
 * - `immediate` — pending retries first (snapshot order), then pending
 *   first-pass puzzles (snapshot order);
 * - `endOfCycle` — pending first-pass puzzles, then pending retries;
 * - `none` — pending first-pass puzzles only.
 *
 * A retry is pending exactly when a puzzle has one `failed` presentation and no
 * later one. Missing puzzle rows are terminal and never enqueued.
 */
export function reconstructResume(input: CycleProgressInput): ResumeQueue {
  const grouped = groupAttempts(input.attempts);
  const missing = input.missingPuzzleIds;
  const firstPass: ResumeEntry[] = [];
  const retries: ResumeEntry[] = [];
  for (const puzzleId of input.puzzleIds) {
    if (missing?.has(puzzleId)) {
      continue;
    }
    const resolution = resolvePuzzleCycle(puzzleId, grouped.get(puzzleId) ?? []);
    if (resolution.presentationCount === 0) {
      firstPass.push({ puzzleId, presentationIndex: 1 });
    } else if (
      input.retryFailed !== 'none' &&
      resolution.presentationCount === 1 &&
      resolution.lastResult === 'failed'
    ) {
      retries.push({ puzzleId, presentationIndex: 2 });
    }
  }
  if (input.retryFailed === 'immediate') {
    return [...retries, ...firstPass];
  }
  return [...firstPass, ...retries];
}

/** Group attempt rows by puzzle id, preserving each puzzle's input order. */
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

/**
 * Map a cycle config's hint settings onto the Feature-012 `SolveHintConfig`
 * consumed by the solving screen.
 */
export function solveHintConfigOf(config: CycleConfig): SolveHintConfig {
  return {
    enabledLevels: [...config.hints.enabledLevels],
    firstHintLevel: config.hints.firstHintLevel,
  };
}

/** Result of `validateCycleConfig`. */
export type ValidateCycleConfigResult =
  | { readonly ok: true; readonly config: CycleConfig }
  | { readonly ok: false; readonly message: string };

const ORDERING_POLICIES: readonly OrderingPolicy[] = ['difficultyAsc', 'sourcePly', 'manual'];
const RETRY_FAILED_MODES: readonly RetryFailed[] = ['none', 'endOfCycle', 'immediate'];

/**
 * Validate an untyped persisted config. Rejects unknown enums, an unsupported
 * `configVersion`, malformed hint levels and out-of-range targets with a typed
 * error; never coerces or defaults a value. Extra keys are dropped so the
 * returned config is exactly the known shape.
 */
export function validateCycleConfig(raw: unknown): ValidateCycleConfigResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'Cycle config must be an object.' };
  }
  const value = raw as Record<string, unknown>;
  if (!isOrderingPolicy(value.ordering)) {
    return { ok: false, message: `Unknown ordering policy "${String(value.ordering)}".` };
  }
  if (!isRetryFailed(value.retryFailed)) {
    return { ok: false, message: `Unknown retryFailed mode "${String(value.retryFailed)}".` };
  }
  const hints = validateHintConfig(value.hints);
  if (!hints.ok) {
    return hints;
  }
  if (typeof value.allowSkip !== 'boolean') {
    return { ok: false, message: 'allowSkip must be a boolean.' };
  }
  const targetAccuracy = validateTargetAccuracy(value.targetAccuracy);
  if (!targetAccuracy.ok) {
    return targetAccuracy;
  }
  const targetSolvingTimeMs = validateNonNegativeNumber(
    value.targetSolvingTimeMs,
    'targetSolvingTimeMs',
  );
  if (!targetSolvingTimeMs.ok) {
    return targetSolvingTimeMs;
  }
  const plannedCycles = validatePlannedCycles(value.plannedCycles);
  if (!plannedCycles.ok) {
    return plannedCycles;
  }
  if (value.configVersion !== CYCLE_CONFIG_VERSION) {
    return {
      ok: false,
      message: `Unsupported cycle config version "${String(value.configVersion)}".`,
    };
  }
  return {
    ok: true,
    config: {
      ordering: value.ordering,
      retryFailed: value.retryFailed,
      hints: hints.config,
      allowSkip: value.allowSkip,
      targetAccuracy: targetAccuracy.value,
      targetSolvingTimeMs: targetSolvingTimeMs.value,
      plannedCycles: plannedCycles.value,
      configVersion: CYCLE_CONFIG_VERSION,
    },
  };
}

function isOrderingPolicy(value: unknown): value is OrderingPolicy {
  return typeof value === 'string' && (ORDERING_POLICIES as readonly string[]).includes(value);
}

function isRetryFailed(value: unknown): value is RetryFailed {
  return typeof value === 'string' && (RETRY_FAILED_MODES as readonly string[]).includes(value);
}

function isHintLevel(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Result of `validateHintConfig`. */
export type ValidateHintConfigResult =
  | { readonly ok: true; readonly config: HintConfig }
  | { readonly ok: false; readonly message: string };

/**
 * Validate an untyped persisted `HintConfig` (levels subset of `1..4`,
 * `firstHintLevel` in `1..4`; an empty `enabledLevels` is a valid "hints off").
 * Never coerces or defaults a value; extra keys are dropped. Exported so the
 * global default-hint settings hook can validate the stored value without
 * synthesizing a whole `CycleConfig`.
 */
export function validateHintConfig(raw: unknown): ValidateHintConfigResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'hints must be an object.' };
  }
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.enabledLevels)) {
    return { ok: false, message: 'hints.enabledLevels must be an array.' };
  }
  const levels: (1 | 2 | 3 | 4)[] = [];
  for (const level of value.enabledLevels) {
    if (!isHintLevel(level)) {
      return { ok: false, message: `Unknown hint level "${String(level)}".` };
    }
    levels.push(level);
  }
  if (!isHintLevel(value.firstHintLevel)) {
    return { ok: false, message: `Unknown first hint level "${String(value.firstHintLevel)}".` };
  }
  return { ok: true, config: { enabledLevels: levels, firstHintLevel: value.firstHintLevel } };
}

type NumberValidation =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly message: string };

function validateTargetAccuracy(raw: unknown): NumberValidation {
  if (raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    return { ok: false, message: 'targetAccuracy must be null or a number in [0, 1].' };
  }
  return { ok: true, value: raw };
}

function validateNonNegativeNumber(raw: unknown, field: string): NumberValidation {
  if (raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return { ok: false, message: `${field} must be null or a non-negative number.` };
  }
  return { ok: true, value: raw };
}

function validatePlannedCycles(raw: unknown): NumberValidation {
  if (raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return { ok: false, message: 'plannedCycles must be null or a positive integer.' };
  }
  return { ok: true, value: raw };
}
