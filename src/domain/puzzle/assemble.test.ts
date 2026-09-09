import { describe, expect, it } from 'vitest';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import type { EvalCpMate } from '@/domain/chess';
import { assembleBlunderPuzzle, assemblePuzzle, blunderDifficultyOf } from './assemble';
import { PUZZLE_GENERATOR_VERSION } from './types';
import {
  blunderPuzzleInputFixture,
  blunderRowFixture,
  puzzleFixture,
  puzzleRowFixture,
  PUZZLE_FIXTURE_NOW,
} from './test-support';

function candidateOverrides(
  overrides: Partial<VerifiedTacticalCandidate>,
): VerifiedTacticalCandidate {
  return { ...puzzleFixture('mate-one'), ...overrides };
}

describe('assemblePuzzle', () => {
  it('produces a complete immutable row from a verified candidate (AC #1)', () => {
    const candidate = puzzleFixture('mate-two');
    const row = assemblePuzzle(candidate, PUZZLE_FIXTURE_NOW);

    expect(row).toMatchObject({
      sourceGameId: candidate.sourceGameId,
      sourcePly: candidate.sourcePly,
      analysisId: candidate.analysisId,
      startingFen: candidate.startingFen,
      userMovePlayed: candidate.userMovePlayed,
      sideToMove: 'white',
      bestMove: candidate.bestMove,
      bestPv: [...candidate.bestPv],
      acceptedFirstMoves: [candidate.bestMove],
      tacticalObjective: candidate.tacticalObjective,
      difficulty: candidate.difficulty,
      candidateSolutionLength: candidate.candidateSolutionLength,
      puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
      detectionVersion: candidate.detectionVersion,
      candidateGenerationVersion: candidate.candidateGenerationVersion,
      createdAt: PUZZLE_FIXTURE_NOW,
    });
    expect(row.verificationMetadata).toEqual(candidate.verificationMetadata);
  });

  it('carries no scheduling/training state (ADR-031)', () => {
    const row = puzzleRowFixture('material-combination');
    expect(row).not.toHaveProperty('state');
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('schedule');
    expect(row).not.toHaveProperty('due');
  });

  it('copies the stored difficulty — including a real 0 — never recomputes (AC #2)', () => {
    const zero = assemblePuzzle(candidateOverrides({ difficulty: 0 }), PUZZLE_FIXTURE_NOW);
    expect(zero.difficulty).toBe(0);

    const forty = assemblePuzzle(
      candidateOverrides({ difficulty: 40, sourceGameId: 'fixture:zero-control' }),
      PUZZLE_FIXTURE_NOW,
    );
    expect(forty.difficulty).toBe(40);
  });

  it('derives side-to-move from the starting-FEN mover — the user is the mover (AC #3)', () => {
    expect(assemblePuzzle(puzzleFixture('mate-one'), 1).sideToMove).toBe('white');

    const whiteFen = puzzleFixture('mate-one').startingFen;
    const black = assemblePuzzle(
      candidateOverrides({
        sourceGameId: 'fixture:black-side',
        startingFen: whiteFen.replace(' w ', ' b '),
      }),
      1,
    );
    expect(black.sideToMove).toBe('black');
  });

  it('retains the verified line and alternatives contract', () => {
    // Absent acceptedFirstMoves (mate fast path) default to the singleton best move.
    expect(assemblePuzzle(puzzleFixture('mate-one'), 1).acceptedFirstMoves).toEqual(['h5f7']);

    // Persisted alternatives are copied, never re-derived.
    const alt = puzzleFixture('accepted-alternatives');
    const altRow = assemblePuzzle(alt, PUZZLE_FIXTURE_NOW);
    expect(altRow.acceptedFirstMoves).toEqual(['g5f7', 'g5e6']);
    expect(altRow.bestPv).toEqual([...alt.bestPv]);
    expect(altRow.candidateSolutionLength).toBe(alt.bestPv.length);
  });

  it('assembles a stored-analysis fast-path candidate identically (metadata differs only)', () => {
    const candidate = puzzleFixture('mate-one');
    expect(candidate.verificationSource).toBe('stored-analysis');
    const row = assemblePuzzle(candidate, PUZZLE_FIXTURE_NOW);
    expect(row.verificationMetadata).toEqual(candidate.verificationMetadata);
    expect(row.difficulty).toBe(candidate.difficulty);
  });

  it('retains the version trio on the row', () => {
    const row = puzzleRowFixture('multi-move-combination');
    expect(row.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);
    expect(row.detectionVersion).toBe(10);
    expect(row.candidateGenerationVersion).toBe(2);
  });

  it('throws on a candidate with an unparseable starting FEN', () => {
    expect(() => assemblePuzzle(candidateOverrides({ startingFen: 'not-a-fen' }), 1)).toThrow(
      /unparseable starting FEN/,
    );
  });

  it('throws on a candidate that lacks the ADR-025 difficulty estimate', () => {
    const stripped = { ...puzzleFixture('mate-one') };
    delete (stripped as { difficulty?: number }).difficulty;
    expect(() => assemblePuzzle(stripped, 1)).toThrow(/no ADR-025 difficulty estimate/);
  });

  it('cross-game separation: each row is built solely from its own candidate', () => {
    const row = assemblePuzzle(puzzleFixture('mate-one'), PUZZLE_FIXTURE_NOW);
    const other = assemblePuzzle(
      { ...puzzleFixture('mate-one'), sourceGameId: 'fixture:other-game', sourcePly: 99 },
      PUZZLE_FIXTURE_NOW,
    );
    // Identity comes entirely from the source candidate.
    expect(row.sourceGameId).toBe('fixture:mate-one');
    expect(other.sourceGameId).toBe('fixture:other-game');
    expect(row.sourcePly).toBe(6);
    expect(other.sourcePly).toBe(99);
    // Content-equal but never shared references (no cross-row aliasing).
    expect(row.bestPv).toEqual(other.bestPv);
    expect(row.bestPv).not.toBe(other.bestPv);
  });
});

describe('assembleBlunderPuzzle', () => {
  it('assembles an honest one-move blunder row (origin blunder, no tactical fields)', () => {
    const input = blunderPuzzleInputFixture('correct-move');
    const row = assembleBlunderPuzzle(input, PUZZLE_FIXTURE_NOW);

    expect(row).toMatchObject({
      sourceGameId: input.sourceGameId,
      sourcePly: input.sourcePly,
      analysisId: input.analysisId,
      startingFen: input.startingFen,
      userMovePlayed: input.userMovePlayed,
      sideToMove: 'white',
      bestMove: input.bestMove,
      origin: 'blunder',
      difficulty: blunderDifficultyOf(input.evalBefore, input.evalAfter),
      puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
      detectionVersion: input.detectionVersion,
      createdAt: PUZZLE_FIXTURE_NOW,
    });
    // The whole solution is the single best move.
    expect(row.bestPv).toEqual([input.bestMove]);
    // No tactical-only fields and no candidate on an honest blunder row.
    expect(row.tacticalObjective).toBeUndefined();
    expect(row.verificationMetadata).toBeUndefined();
    expect(row.candidateSolutionLength).toBeUndefined();
    expect(row.acceptedFirstMoves).toBeUndefined();
    expect(row.candidateGenerationVersion).toBeNull();
    // Immutability: no scheduling/training state (ADR-031).
    expect(row).not.toHaveProperty('state');
    expect(row).not.toHaveProperty('due');
  });

  it('throws on an unparseable starting FEN', () => {
    const input = { ...blunderPuzzleInputFixture('correct-move'), startingFen: 'not-a-fen' };
    expect(() => assembleBlunderPuzzle(input, 1)).toThrow(/unparseable starting FEN/);
  });
});

describe('blunderDifficultyOf', () => {
  it('is monotonic: a bigger win-probability swing yields an EASIER (lower) score', () => {
    // Tiny blunder-floor swing (~15 wp) → hard-ish correct-move puzzle.
    const subtle: [EvalCpMate, EvalCpMate] = [
      { cp: 200, mate: null },
      { cp: 200 - 60, mate: null },
    ];
    // Huge swing (a hanging-queen-style blunder) → trivial-to-find move.
    const huge: [EvalCpMate, EvalCpMate] = [
      { cp: 1000, mate: null },
      { cp: -1000, mate: null },
    ];
    const subtleScore = blunderDifficultyOf(subtle[0]!, subtle[1]!);
    const hugeScore = blunderDifficultyOf(huge[0]!, huge[1]!);
    expect(subtleScore).toBeGreaterThan(hugeScore);
    // Huge swing clamps near the easy end; the score never leaves [0, 100].
    expect(hugeScore).toBeLessThan(10);
    expect(hugeScore).toBeGreaterThanOrEqual(0);
  });

  it('keeps scores in [0, 100] for degenerate/mate evaluations', () => {
    // Mate values behave like extreme centipawns through the win-percent curve.
    const mated: [EvalCpMate, EvalCpMate] = [
      { cp: null, mate: -1 },
      { cp: null, mate: 1 },
    ];
    const score = blunderDifficultyOf(mated[0]!, mated[1]!);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);

    // A no-op (equal evals) would be a 100 — clamped to the max.
    const equal = blunderDifficultyOf({ cp: 0, mate: null }, { cp: 0, mate: null });
    expect(equal).toBe(100);
  });

  it('matches the assembled row difficulty exactly (deterministic)', () => {
    const input = blunderPuzzleInputFixture('correct-move');
    const row = blunderRowFixture('correct-move');
    expect(row.difficulty).toBe(blunderDifficultyOf(input.evalBefore, input.evalAfter));
  });
});
