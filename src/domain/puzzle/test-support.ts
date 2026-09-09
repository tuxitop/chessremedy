/**
 * Feature 011 — deterministic verified-candidate puzzle fixtures (domain).
 *
 * Seven engine-free, hand-authored `VerifiedTacticalCandidate` fixtures
 * covering the spec's fixture kinds plus one one-move blunder "correct-move"
 * fixture. Every board + UCI line is legal (the repository's own `walkLine`
 * replays each `bestPv` without error — asserted in `test-support.test.ts`).
 * Component and repository tests share this single source via
 * `puzzleFixture(kind)` / `puzzleRowFixture(kind)` and the blunder
 * `blunderRowFixture(kind)`.
 */

import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { PuzzleRow } from './types';
import { assembleBlunderPuzzle, assemblePuzzle } from './assemble';
import type { BlunderPuzzleInput } from './assemble';

/** The seven deterministic fixture kinds (spec "Deterministic fixtures"). */
export type PuzzleFixtureKind =
  | 'mate-one'
  | 'mate-two'
  | 'material-combination'
  | 'exchange-win'
  | 'missed-opportunity'
  | 'multi-move-combination'
  | 'accepted-alternatives';

/** FEN of the missed-mate position before White's 4th move (ply 6). */
export const MATE_ONE_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
/** FEN of the mate-in-two position (White K+Q vs Black K, brute-force verified). */
export const MATE_TWO_FEN = '1Q6/8/8/8/8/6K1/8/6k1 w - - 0 1';
/** FEN of the Nxf7 fork position (verify.test.ts corpus). */
export const FORK_FEN = 'r1bqkb1r/pppp1pp1/2n2n1p/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5';
/** FEN of the single-capture exchange win (Rxd3). */
export const EXCHANGE_FEN = '4k3/8/8/8/8/R2q4/8/4K3 w - - 0 1';
/** FEN of the 5-ply multi-move combination (plan-14 ply-24 shape). */
export const COMBO_24_FEN = 'r3k2r/1ppq2pp/pn2bp2/n1b1p3/8/1BPP4/PP1B1PPP/RN1Q1RK1 w kq - 3 13';
/** FEN of the 7-ply quiet-defender combination (plan-14 ply-26 shape). */
export const COMBO_26_FEN = 'r2k3r/1ppq2pp/pn2bp2/n1b1p2Q/8/1BPP4/PP1B1PPP/RN3RK1 w - - 5 14';

export const PUZZLE_FIXTURE_NOW = 1_700_000_000_000;

interface KindSpec {
  readonly sourceGameId: string;
  readonly sourcePly: number;
  readonly startingFen: string;
  readonly userMovePlayed: string;
  readonly bestMove: string;
  readonly bestPv: readonly string[];
  readonly acceptedFirstMoves?: readonly string[];
  readonly tacticalObjective: VerifiedTacticalCandidate['tacticalObjective'];
  readonly difficulty: number;
  readonly verificationSource?: VerifiedTacticalCandidate['verificationSource'];
}

const SPECS: Readonly<Record<PuzzleFixtureKind, KindSpec>> = {
  'mate-one': {
    sourceGameId: 'fixture:mate-one',
    sourcePly: 6,
    startingFen: MATE_ONE_FEN,
    userMovePlayed: 'd2d3',
    bestMove: 'h5f7',
    bestPv: ['h5f7'],
    tacticalObjective: 'forcing_mate',
    difficulty: 12,
    verificationSource: 'stored-analysis',
  },
  'mate-two': {
    sourceGameId: 'fixture:mate-two',
    sourcePly: 10,
    startingFen: MATE_TWO_FEN,
    userMovePlayed: 'g3g2',
    bestMove: 'b8b6',
    bestPv: ['b8b6', 'g1f1', 'b6f2'],
    tacticalObjective: 'forcing_mate',
    difficulty: 25,
  },
  'material-combination': {
    sourceGameId: 'fixture:material-combination',
    sourcePly: 8,
    startingFen: FORK_FEN,
    userMovePlayed: 'g2g3',
    bestMove: 'g5f7',
    bestPv: ['g5f7', 'd8e7', 'f7h8'],
    tacticalObjective: 'winning_material',
    difficulty: 48,
  },
  'exchange-win': {
    sourceGameId: 'fixture:exchange-win',
    sourcePly: 12,
    startingFen: EXCHANGE_FEN,
    userMovePlayed: 'e1e2',
    bestMove: 'a3d3',
    bestPv: ['a3d3'],
    tacticalObjective: 'winning_material',
    difficulty: 30,
  },
  'missed-opportunity': {
    sourceGameId: 'fixture:missed-opportunity',
    sourcePly: 14,
    startingFen: COMBO_26_FEN,
    userMovePlayed: 'a2a3',
    bestMove: 'b3e6',
    bestPv: ['b3e6', 'd7e6', 'b2b4', 'g7g6', 'h5e2', 'c5b4', 'c3b4'],
    tacticalObjective: 'winning_material',
    difficulty: 62,
  },
  'multi-move-combination': {
    sourceGameId: 'fixture:multi-move-combination',
    sourcePly: 18,
    startingFen: COMBO_24_FEN,
    userMovePlayed: 'h2h3',
    bestMove: 'b3e6',
    bestPv: ['b3e6', 'd7e6', 'b2b4', 'c5b4', 'c3b4'],
    tacticalObjective: 'winning_material',
    difficulty: 55,
  },
  'accepted-alternatives': {
    sourceGameId: 'fixture:accepted-alternatives',
    sourcePly: 20,
    startingFen: FORK_FEN,
    userMovePlayed: 'g2g4',
    bestMove: 'g5f7',
    bestPv: ['g5f7', 'd8e7', 'f7h8'],
    acceptedFirstMoves: ['g5f7', 'g5e6'],
    tacticalObjective: 'winning_material',
    difficulty: 52,
  },
};

function metadataFor(kind: PuzzleFixtureKind): VerifiedTacticalCandidate['verificationMetadata'] {
  const spec = SPECS[kind];
  const isMate = spec.tacticalObjective === 'forcing_mate';
  return {
    engineName: 'stockfish',
    engineVersion: '18.0.8',
    engineBuild: 'stockfish-18-lite',
    analysisVersion: 1,
    verificationDepth: 22,
    verificationTimestamp: PUZZLE_FIXTURE_NOW + 500,
    wdlAfterBestLine: isMate ? { w: 1000, d: 0, l: 0 } : { w: 900, d: 60, l: 40 },
  };
}

function specFor(kind: PuzzleFixtureKind): VerifiedTacticalCandidate {
  const spec = SPECS[kind];
  return {
    id: `puzzle-fixture:${kind}`,
    analysisId: `analysis:${kind}`,
    sourceGameId: spec.sourceGameId,
    sourcePly: spec.sourcePly,
    startingFen: spec.startingFen,
    userMovePlayed: spec.userMovePlayed,
    bestMove: spec.bestMove,
    bestPv: [...spec.bestPv],
    wpLoss: 25,
    evalCpBefore: -20,
    evalCpAfterUserMove: -220,
    candidateGenerationVersion: 2,
    createdAt: PUZZLE_FIXTURE_NOW - 1_000,
    tacticalObjective: spec.tacticalObjective,
    candidateSolutionLength: spec.bestPv.length,
    verificationMetadata: metadataFor(kind),
    detectionVersion: DETECTION_VERSION,
    verificationStatus: 'verified',
    verificationSource: spec.verificationSource ?? 'tactical-search',
    difficulty: spec.difficulty,
    ...(spec.acceptedFirstMoves ? { acceptedFirstMoves: [...spec.acceptedFirstMoves] } : {}),
  };
}

/** A deterministic verified candidate fixture of the given kind. */
export function puzzleFixture(kind: PuzzleFixtureKind): VerifiedTacticalCandidate {
  return specFor(kind);
}

export const PUZZLE_FIXTURE_KINDS = Object.keys(SPECS) as readonly PuzzleFixtureKind[];

/** The same fixture assembled into an immutable puzzle row (createdAt fixed). */
export function puzzleRowFixture(kind: PuzzleFixtureKind): PuzzleRow {
  return assemblePuzzle(specFor(kind), PUZZLE_FIXTURE_NOW);
}

/** Index of every fixture kind → assembled row (shared by Stage D/E/F tests). */
export const puzzleFixtures: Readonly<Record<PuzzleFixtureKind, PuzzleRow>> = {
  'mate-one': puzzleRowFixture('mate-one'),
  'mate-two': puzzleRowFixture('mate-two'),
  'material-combination': puzzleRowFixture('material-combination'),
  'exchange-win': puzzleRowFixture('exchange-win'),
  'missed-opportunity': puzzleRowFixture('missed-opportunity'),
  'multi-move-combination': puzzleRowFixture('multi-move-combination'),
  'accepted-alternatives': puzzleRowFixture('accepted-alternatives'),
};

// --- One-move blunder "correct-move" fixture (origin 'blunder') --------------

/** The deterministic one-move blunder fixture kinds (spec "Fixture puzzles"). */
export type BlunderFixtureKind = 'correct-move';

const BLUNDER_SPECS: Readonly<Record<BlunderFixtureKind, BlunderPuzzleInput>> = {
  'correct-move': {
    sourceGameId: 'fixture:blunder-correct-move',
    sourcePly: 8,
    analysisId: 'analysis:blunder-correct-move',
    // The missed-mate position before White's move: the user played d2d3 and
    // missed the engine's 4.Qxf7# — a one-move correct-move decision point.
    startingFen: MATE_ONE_FEN,
    userMovePlayed: 'd2d3',
    bestMove: 'h5f7',
    // Best-line evaluation of the position (the best move mates) vs the value
    // of the played blunder: a deterministic swing the difficulty derives from.
    evalBefore: { mate: 1, cp: null },
    evalAfter: { cp: -300, mate: null },
    detectionVersion: DETECTION_VERSION,
  },
};

/** A deterministic qualifying-blunder input fixture (engine-free). */
export function blunderPuzzleInputFixture(
  kind: BlunderFixtureKind = 'correct-move',
): BlunderPuzzleInput {
  return { ...BLUNDER_SPECS[kind]! };
}

/** The blunder input fixture assembled into an immutable puzzle row. */
export function blunderRowFixture(kind: BlunderFixtureKind = 'correct-move'): PuzzleRow {
  return assembleBlunderPuzzle(blunderPuzzleInputFixture(kind), PUZZLE_FIXTURE_NOW);
}

/** Index of blunder fixture kind → assembled row (component/service tests). */
export const blunderPuzzleFixtures: Readonly<Record<BlunderFixtureKind, PuzzleRow>> = {
  'correct-move': blunderRowFixture('correct-move'),
};
