/**
 * Feature 012 — deterministic training fixtures (domain).
 *
 * The canonical training input is the Feature-011 fixture surface — the
 * assembled `PuzzleRow`s for both origins (`puzzleRowFixture(kind)` /
 * `blunderRowFixture(kind)`) — re-exported here so Stage C/D/F tests share one
 * source. Feature-012 supplements it with hand-authored legal rows for the
 * presentation cases Feature-011 does not cover: canonical **promotion** UCI,
 * an **en-passant** capture, and **castling** (all as the accepted first move,
 * each legal and `bestPv`-walkable — asserted in `test-support.test.ts`). The
 * Feature-011 `accepted-alternatives` row is the terminal accepted-alternative
 * case (its non-`bestMove` alternative has no stored continuation).
 *
 * Everything is engine/network/IndexedDB-free and deterministic (a fixed
 * fixture clock); supplementary rows never go through `chessops` at fixture
 * time — walkability is asserted by the walker in tests.
 */

import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { PUZZLE_FIXTURE_NOW, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { PuzzleOrigin, PuzzleRow } from '@/domain/puzzle/types';
import { PUZZLE_GENERATOR_VERSION } from '@/domain/puzzle/types';
import { buildAttemptRow, type OutcomeTrigger } from './outcome';
import { DEFAULT_BLOCK_SIZE } from './autoSet';
import {
  CYCLE_METRICS_VERSION,
  DEFAULT_CYCLE_CONFIG,
  DEFAULT_TARGET_SIZE,
  type CycleConfig,
  type PuzzlePoolEntry,
  type SetSource,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
  type TrainingCycleStatus,
  type TrainingSetStatus,
} from './cycleTypes';
import type {
  HintLevel,
  PresentationCounters,
  PuzzleAttemptRow,
  SessionPuzzleContext,
  SolveHintConfig,
  TrainingResult,
} from './types';

export {
  PUZZLE_FIXTURE_KINDS,
  PUZZLE_FIXTURE_NOW,
  blunderPuzzleFixtures,
  blunderRowFixture,
  puzzleFixtures,
  puzzleRowFixture,
} from '@/domain/puzzle/test-support';
export type { BlunderFixtureKind, PuzzleFixtureKind } from '@/domain/puzzle/test-support';

// --- Feature-012 supplementary rows -----------------------------------------

/**
 * FEN where White is to move and the accepted first move promotes: c7-c8=Q
 * (`c7c8q`, canonical promotion UCI). Underpromotions on the same square are
 * legal but wrong; `c7c8` without a piece is illegal.
 */
export const PROMOTION_FEN = '4k3/2P5/8/8/8/8/8/4K3 w - - 0 1';

/**
 * FEN where Black has just played f7-f5 (en-passant target f6) and White's
 * accepted first move is the en-passant capture e5xf6 (`e5f6`, canonical
 * capture token). The quiet push `e5e6` is legal but wrong.
 */
export const EN_PASSANT_FEN = '4k3/p7/8/4Pp2/8/8/8/4K3 w - f6 0 3';

/**
 * FEN where White may castle and the accepted first move is O-O (`e1g1`); the
 * stored line continues with Black's reply `e8e7` (auto-played) so the row
 * also exercises line parity. O-O-O (`e1c1`) is legal but wrong.
 */
export const CASTLING_FEN = '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1';

const PROMOTION_ROW: PuzzleRow = {
  sourceGameId: 'fixture:promotion',
  sourcePly: 36,
  analysisId: 'analysis:promotion',
  startingFen: PROMOTION_FEN,
  userMovePlayed: 'e1d2',
  sideToMove: 'white',
  bestMove: 'c7c8q',
  bestPv: ['c7c8q'],
  origin: 'tactical',
  acceptedFirstMoves: ['c7c8q'],
  tacticalObjective: 'winning_material',
  difficulty: 20,
  puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  detectionVersion: DETECTION_VERSION,
  candidateGenerationVersion: 2,
  createdAt: PUZZLE_FIXTURE_NOW,
};

const EN_PASSANT_ROW: PuzzleRow = {
  sourceGameId: 'fixture:en-passant',
  sourcePly: 44,
  analysisId: 'analysis:en-passant',
  startingFen: EN_PASSANT_FEN,
  userMovePlayed: 'e1e2',
  sideToMove: 'white',
  bestMove: 'e5f6',
  bestPv: ['e5f6'],
  origin: 'tactical',
  acceptedFirstMoves: ['e5f6'],
  tacticalObjective: 'winning_material',
  difficulty: 35,
  puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  detectionVersion: DETECTION_VERSION,
  candidateGenerationVersion: 2,
  createdAt: PUZZLE_FIXTURE_NOW,
};

const CASTLING_ROW: PuzzleRow = {
  sourceGameId: 'fixture:castling',
  sourcePly: 50,
  analysisId: 'analysis:castling',
  startingFen: CASTLING_FEN,
  userMovePlayed: 'e1e2',
  sideToMove: 'white',
  bestMove: 'e1g1',
  bestPv: ['e1g1', 'e8e7'],
  origin: 'tactical',
  acceptedFirstMoves: ['e1g1'],
  tacticalObjective: 'winning_material',
  difficulty: 40,
  puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  detectionVersion: DETECTION_VERSION,
  candidateGenerationVersion: 2,
  createdAt: PUZZLE_FIXTURE_NOW,
};

/** The Feature-012 supplementary fixture kinds. */
export type TrainingFixtureKind = 'promotion' | 'en-passant' | 'castling';

export const TRAINING_FIXTURE_KINDS = ['promotion', 'en-passant', 'castling'] as const;

/** Prebuilt supplementary rows, indexed by kind (deterministic, immutable). */
export const trainingSupplementaryFixtures: Readonly<Record<TrainingFixtureKind, PuzzleRow>> = {
  promotion: PROMOTION_ROW,
  'en-passant': EN_PASSANT_ROW,
  castling: CASTLING_ROW,
};

/** A supplementary Feature-012 training row of the given kind. */
export function trainingRowFixture(kind: TrainingFixtureKind): PuzzleRow {
  return trainingSupplementaryFixtures[kind];
}

/** The Feature-011 `accepted-alternatives` row: its extra first move is terminal. */
export function terminalAlternativeRowFixture(): PuzzleRow {
  return puzzleRowFixture('accepted-alternatives');
}

// --- shared session fixtures -------------------------------------------------

/**
 * Default per-set solve hint config (mirrors the product default in
 * `hints.ts`): level 1 (text-only) is skipped so the first press visibly
 * reveals the source square; presses ascend 2 → 3 → 4.
 */
export function solveConfigFixture(): SolveHintConfig {
  return { enabledLevels: [2, 3, 4], firstHintLevel: 2 };
}

export const DEFAULT_CYCLE_ID = 'fixture:cycle';
export const DEFAULT_TRAINING_SET_ID = 'fixture:set';
export const DEFAULT_PRESENTATION_INDEX = 1;

/**
 * A deterministic `SessionPuzzleContext`. `puzzleId` is accepted for parity
 * with the Feature-013 host call shape but the context intentionally does not
 * carry it (the puzzle is identified by its row; the attempt's `puzzleId` is
 * derived at write time via `puzzleIdOf`).
 */
export function cycleContextFixture(
  cycleId: string,
  _puzzleId: string,
  presentationIndex: number,
): SessionPuzzleContext {
  return { trainingSetId: DEFAULT_TRAINING_SET_ID, cycleId, presentationIndex };
}

/** Overrides for `attemptRowFixture`; every field defaults deterministically. */
export interface AttemptRowFixtureOverrides {
  readonly row?: PuzzleRow;
  readonly context?: SessionPuzzleContext;
  readonly trigger?: OutcomeTrigger;
  readonly counters?: PresentationCounters;
  readonly startedAt?: number;
  readonly endedAt?: number;
}

/**
 * A deterministic immutable attempt row built through the real
 * `buildAttemptRow` (defaults: the Feature-011 `mate-two` row in the fixture
 * cycle, a clean `solved` outcome, fixed wall-clock). Override any input to
 * shape a specific result for Stage C/D/F tests.
 */
export function attemptRowFixture(overrides: AttemptRowFixtureOverrides = {}): PuzzleAttemptRow {
  const row = overrides.row ?? puzzleRowFixture('mate-two');
  const context = overrides.context ?? cycleContextFixture(DEFAULT_CYCLE_ID, 'fixture:mate-two', 1);
  const startedAt = overrides.startedAt ?? PUZZLE_FIXTURE_NOW;
  return buildAttemptRow({
    row,
    context,
    trigger: overrides.trigger ?? 'solved',
    counters: overrides.counters ?? {
      wrongMoveCount: 0,
      hintCount: 0,
      highestHintLevel: null,
      restartCount: 0,
    },
    startedAt,
    endedAt: overrides.endedAt ?? startedAt + 5_000,
  });
}

// --- Feature-013 set/cycle fixtures -----------------------------------------

/** Deep-copy a config so a fixture never aliases the shared default. */
function cloneConfig(config: CycleConfig): CycleConfig {
  return {
    ...config,
    hints: { ...config.hints, enabledLevels: [...config.hints.enabledLevels] },
  };
}

/** Overrides for `setFixture`; every field defaults deterministically. */
export interface SetFixtureOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly status?: TrainingSetStatus;
  readonly source?: SetSource;
  readonly puzzleIds?: readonly string[];
  readonly targetSize?: number;
  readonly config?: CycleConfig;
}

/**
 * A deterministic training-set row (default: the fixture set id, active, manual
 * source, empty membership, default target size and config).
 */
export function setFixture(overrides: SetFixtureOverrides = {}): TacticalTrainingSetRow {
  return {
    id: overrides.id ?? DEFAULT_TRAINING_SET_ID,
    name: overrides.name ?? 'Fixture set',
    createdAt: overrides.createdAt ?? PUZZLE_FIXTURE_NOW,
    updatedAt: overrides.updatedAt ?? PUZZLE_FIXTURE_NOW,
    status: overrides.status ?? 'active',
    source: overrides.source ?? { kind: 'manual' },
    puzzleIds: [...(overrides.puzzleIds ?? [])],
    targetSize: overrides.targetSize ?? DEFAULT_TARGET_SIZE,
    config: cloneConfig(overrides.config ?? DEFAULT_CYCLE_CONFIG),
  };
}

/** Overrides for `cycleFixture`; every field defaults deterministically. */
export interface CycleFixtureOverrides {
  readonly id?: string;
  readonly trainingSetId?: string;
  readonly cycleNumber?: number;
  readonly status?: TrainingCycleStatus;
  readonly startedAt?: number;
  readonly updatedAt?: number;
  readonly completedAt?: number | null;
  readonly abandonedAt?: number | null;
  readonly puzzleIds?: readonly string[];
  readonly config?: CycleConfig;
  readonly cycleMetricsVersion?: number;
}

/**
 * A deterministic training-cycle row (default: cycle 1 of the fixture set,
 * `inProgress`, no attempts implied, default config and metrics version).
 */
export function cycleFixture(overrides: CycleFixtureOverrides = {}): TrainingCycleRow {
  return {
    id: overrides.id ?? DEFAULT_CYCLE_ID,
    trainingSetId: overrides.trainingSetId ?? DEFAULT_TRAINING_SET_ID,
    cycleNumber: overrides.cycleNumber ?? 1,
    status: overrides.status ?? 'inProgress',
    startedAt: overrides.startedAt ?? PUZZLE_FIXTURE_NOW,
    updatedAt: overrides.updatedAt ?? overrides.startedAt ?? PUZZLE_FIXTURE_NOW,
    completedAt: overrides.completedAt ?? null,
    abandonedAt: overrides.abandonedAt ?? null,
    puzzleIds: [...(overrides.puzzleIds ?? [])],
    config: cloneConfig(overrides.config ?? DEFAULT_CYCLE_CONFIG),
    cycleMetricsVersion: overrides.cycleMetricsVersion ?? CYCLE_METRICS_VERSION,
  };
}

/** Overrides for `cycleAttemptFixture`; every field defaults deterministically. */
export interface CycleAttemptFixtureOverrides {
  readonly puzzleId?: string;
  readonly trainingSetId?: string;
  readonly cycleId?: string;
  readonly presentationIndex?: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly result?: TrainingResult;
  readonly solvingTimeMs?: number;
  readonly wrongMoveCount?: number;
  readonly hintCount?: number;
  readonly highestHintLevel?: HintLevel | null;
  readonly restartCount?: number;
  readonly solved?: boolean;
  readonly puzzleGeneratorVersion?: number;
  readonly origin?: PuzzleOrigin;
}

/**
 * A deterministic immutable attempt row built directly (no `PuzzleRow`
 * required). Defaults are a first-presentation clean solve; the counters follow
 * the result unless overridden.
 */
export function cycleAttemptFixture(
  overrides: CycleAttemptFixtureOverrides = {},
): PuzzleAttemptRow {
  const result = overrides.result ?? 'solvedFirstTry';
  const startedAt = overrides.startedAt ?? PUZZLE_FIXTURE_NOW;
  const solvingTimeMs = overrides.solvingTimeMs ?? 5_000;
  return {
    puzzleId: overrides.puzzleId ?? puzzleIdOf('fixture:mate-one', 6),
    trainingSetId: overrides.trainingSetId ?? DEFAULT_TRAINING_SET_ID,
    cycleId: overrides.cycleId ?? DEFAULT_CYCLE_ID,
    presentationIndex: overrides.presentationIndex ?? 1,
    startedAt,
    endedAt: overrides.endedAt ?? startedAt + solvingTimeMs,
    result,
    solvingTimeMs,
    wrongMoveCount: overrides.wrongMoveCount ?? (result === 'failed' ? 1 : 0),
    hintCount: overrides.hintCount ?? (result === 'solvedWithHelp' ? 1 : 0),
    highestHintLevel: overrides.highestHintLevel ?? (result === 'solvedWithHelp' ? 2 : null),
    restartCount: overrides.restartCount ?? 0,
    solved: overrides.solved ?? (result === 'solvedFirstTry' || result === 'solvedWithHelp'),
    puzzleGeneratorVersion: overrides.puzzleGeneratorVersion ?? PUZZLE_GENERATOR_VERSION,
    origin: overrides.origin ?? 'tactical',
  };
}

/** Overrides for `poolEntryFixture`; every field defaults deterministically. */
export interface PoolEntryFixtureOverrides {
  readonly puzzle?: PuzzleRow;
  readonly platform?: GameSource;
  readonly timeControlCategory?: TimeControlCategory;
}

/** A deterministic enriched pool entry (default: the `mate-one` fixture row). */
export function poolEntryFixture(overrides: PoolEntryFixtureOverrides = {}): PuzzlePoolEntry {
  return {
    puzzle: overrides.puzzle ?? puzzleRowFixture('mate-one'),
    platform: overrides.platform ?? 'lichess',
    timeControlCategory: overrides.timeControlCategory ?? 'blitz',
  };
}

/** Inputs to `attemptRowsForCycle`. */
export interface AttemptRowsForCycleInput {
  /** The snapshot membership order to build rows for. */
  readonly puzzleIds: readonly string[];
  /**
   * Per puzzle, the results of successive presentations (index 0 is
   * `presentationIndex` 1). A puzzle absent from the record gets no rows.
   */
  readonly results: Readonly<Record<string, readonly TrainingResult[]>>;
  readonly trainingSetId?: string;
  readonly cycleId?: string;
  readonly startedAt?: number;
  readonly presentationGapMs?: number;
  readonly solvingTimes?: Readonly<Record<string, readonly number[]>>;
  readonly wrongMoves?: Readonly<Record<string, readonly number[]>>;
  readonly hints?: Readonly<Record<string, readonly number[]>>;
  readonly restarts?: Readonly<Record<string, readonly number[]>>;
}

/**
 * Build the attempt rows for a cycle from a per-puzzle result script. Rows are
 * emitted in snapshot order and presentation order with a fixed start-time gap,
 * so metrics/resume fixtures are deterministic.
 */
export function attemptRowsForCycle(input: AttemptRowsForCycleInput): PuzzleAttemptRow[] {
  const rows: PuzzleAttemptRow[] = [];
  const base = input.startedAt ?? PUZZLE_FIXTURE_NOW;
  const gap = input.presentationGapMs ?? 10_000;
  let offset = 0;
  for (const puzzleId of input.puzzleIds) {
    const results = input.results[puzzleId] ?? [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      const solvingTimeMs = input.solvingTimes?.[puzzleId]?.[index] ?? 5_000;
      const wrongMoveCount = input.wrongMoves?.[puzzleId]?.[index];
      const hintCount = input.hints?.[puzzleId]?.[index];
      const restartCount = input.restarts?.[puzzleId]?.[index];
      rows.push(
        cycleAttemptFixture({
          puzzleId,
          ...(input.trainingSetId === undefined ? {} : { trainingSetId: input.trainingSetId }),
          ...(input.cycleId === undefined ? {} : { cycleId: input.cycleId }),
          presentationIndex: index + 1,
          startedAt: base + offset,
          solvingTimeMs,
          result,
          ...(wrongMoveCount === undefined ? {} : { wrongMoveCount }),
          ...(hintCount === undefined ? {} : { hintCount }),
          ...(restartCount === undefined ? {} : { restartCount }),
        }),
      );
      offset += gap;
    }
  }
  return rows;
}

// --- Feature-013 block/mastery fixtures -------------------------------------

/** Default id of the block fixture (`setFixture` defaults to the manual set). */
export const DEFAULT_BLOCK_SET_ID = 'fixture:block';

/**
 * A deterministic Woodpecker-block set row: `source.kind === 'auto'` with the
 * default block recipe and an empty membership snapshot. Override `source`
 * and/or `puzzleIds` to shape a specific block.
 */
export function blockSetFixture(overrides: SetFixtureOverrides = {}): TacticalTrainingSetRow {
  return setFixture({
    id: overrides.id ?? DEFAULT_BLOCK_SET_ID,
    name: overrides.name ?? 'Woodpecker block',
    source: { kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: DEFAULT_BLOCK_SIZE } },
    puzzleIds: [],
    ...overrides,
  });
}

/**
 * A deterministic **legacy** auto-set row: `source.kind === 'auto'` with no
 * `recipe` — the untrusted pre-block-model shape the startup cleanup removes.
 * The `source` is cast because the current `SetSource` union requires a recipe
 * for `auto`; the fixture deliberately documents the persisted legacy shape.
 */
export function legacyAutoSetFixture(
  id: string,
  overrides: SetFixtureOverrides = {},
): TacticalTrainingSetRow {
  return setFixture({
    id,
    source: { kind: 'auto' } as unknown as SetSource,
    ...overrides,
  });
}

/**
 * A synthetic pool row for block/pool derivation: provenance/difficulty only,
 * all other fields copied from the `mate-one` fixture.
 */
export function autoPoolRowFixture(index: number, difficulty: number): PuzzleRow {
  return {
    ...puzzleRowFixture('mate-one'),
    sourceGameId: `fixture:auto-${index}`,
    sourcePly: index,
    difficulty,
  };
}

/**
 * One clean first-try row for `puzzleId` in each supplied distinct cycle (a
 * mastery-credit builder).
 */
export function legitimateFirstTryRows(
  puzzleId: string,
  cycleIds: readonly string[],
): PuzzleAttemptRow[] {
  return cycleIds.map((cycleId) =>
    cycleAttemptFixture({
      puzzleId,
      cycleId,
      presentationIndex: 1,
      result: 'solvedFirstTry',
    }),
  );
}

/**
 * A mastery attempt row fixture (defaults to a clean first-try presentation);
 * override the result/counters to shape a disqualified row.
 */
export function masteryAttemptFixture(
  overrides: CycleAttemptFixtureOverrides = {},
): PuzzleAttemptRow {
  return cycleAttemptFixture({ result: 'solvedFirstTry', presentationIndex: 1, ...overrides });
}
