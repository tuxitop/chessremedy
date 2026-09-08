import { describe, expect, it } from 'vitest';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import { assemblePuzzle } from './assemble';
import { PUZZLE_GENERATOR_VERSION } from './types';
import { puzzleFixture, puzzleRowFixture, PUZZLE_FIXTURE_NOW } from './test-support';

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
