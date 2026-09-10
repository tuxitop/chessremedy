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

import { PUZZLE_FIXTURE_NOW, puzzleRowFixture } from '@/domain/puzzle/test-support';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { PUZZLE_GENERATOR_VERSION } from '@/domain/puzzle/types';
import { buildAttemptRow, type OutcomeTrigger } from './outcome';
import type {
  PresentationCounters,
  PuzzleAttemptRow,
  SessionPuzzleContext,
  SolveHintConfig,
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
    counters: overrides.counters ?? { wrongMoveCount: 0, hintCount: 0, highestHintLevel: null },
    startedAt,
    endedAt: overrides.endedAt ?? startedAt + 5_000,
  });
}
