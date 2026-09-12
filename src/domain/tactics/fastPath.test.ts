import { describe, expect, it } from 'vitest';
import { fixtureGame } from '@/domain/chess/fixtures';
import { planGameAnalysis } from '@/domain/analysis';
import { DETECTION_VERSION, fastPathVerifiedCandidate, FAST_PATH_MIN_STORED_DEPTH } from './index';
import type { RawCandidate, StoredLineSource } from './index';

/** Real game position where White (the user) missed 4.Qxf7# (ply 6). */
function mateFen(): string {
  const game = fixtureGame('li-bullet-missed-mate');
  const plan = planGameAnalysis(game);
  if (!plan.ok) {
    throw new Error(plan.message);
  }
  return plan.plan.moves[6]!.positionFen;
}

const ENGINE = { engineName: 'stockfish', engineVersion: '18.0.8', engineBuild: 'lite' };

function rawCandidate(fen: string): RawCandidate {
  return {
    id: 'candidate-1',
    analysisId: 'analysis-1',
    sourceGameId: 'game-1',
    sourcePly: 6,
    startingFen: fen,
    userMovePlayed: 'd2d3',
    bestMove: 'h5f7',
    bestPv: ['h5f7'],
    wpLoss: 55,
    evalCpBefore: null,
    evalCpAfterUserMove: -10,
    candidateGenerationVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function source(overrides: Partial<StoredLineSource> = {}): StoredLineSource {
  return {
    engine: ENGINE,
    depth: 20,
    evalMate: 1,
    bestPv: ['h5f7'],
    analysisVersion: 1,
    ...overrides,
  };
}

describe('tactical detection fast path (plan 012, WP-C)', () => {
  it('verifies a decisive stored mate with no engine run', () => {
    const fen = mateFen();
    const verified = fastPathVerifiedCandidate(rawCandidate(fen), source(), 42);

    expect(verified).not.toBeNull();
    expect(verified!.tacticalObjective).toBe('forcing_mate');
    expect(verified!.candidateSolutionLength).toBe(1);
    expect(verified!.bestMove).toBe('h5f7');
    expect(verified!.bestPv).toEqual(['h5f7']);
    expect(verified!.verificationSource).toBe('stored-analysis');
    expect(verified!.detectionVersion).toBe(DETECTION_VERSION);
    // Feature-011 follow-up: the mate fast path persists a difficulty estimate
    // (computed at the stored line's depth) and the mating move as the only
    // accepted solving move.
    expect(typeof verified!.difficulty).toBe('number');
    expect(verified!.difficulty).toBeGreaterThanOrEqual(15);
    expect(verified!.acceptedFirstMoves).toEqual(['h5f7']);
    expect(verified!.verificationMetadata).toMatchObject({
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'lite',
      verificationDepth: 20,
      verificationTimestamp: 42,
      wdlAfterBestLine: null,
    });
  });

  it('records the stored line depth, never a fabricated tactical depth', () => {
    const fen = mateFen();
    const verified = fastPathVerifiedCandidate(rawCandidate(fen), source({ depth: 24 }), 0);
    expect(verified!.verificationMetadata.verificationDepth).toBe(24);
  });

  it('falls back when the stored line is too shallow', () => {
    const fen = mateFen();
    expect(
      fastPathVerifiedCandidate(
        rawCandidate(fen),
        source({ depth: FAST_PATH_MIN_STORED_DEPTH - 1 }),
        0,
      ),
    ).toBeNull();
  });

  it('falls back when the stored root evaluation is not a mate', () => {
    const fen = mateFen();
    expect(fastPathVerifiedCandidate(rawCandidate(fen), source({ evalMate: null }), 0)).toBeNull();
    expect(fastPathVerifiedCandidate(rawCandidate(fen), source({ evalMate: 0 }), 0)).toBeNull();
    expect(fastPathVerifiedCandidate(rawCandidate(fen), source({ evalMate: -3 }), 0)).toBeNull();
  });

  it('falls back when the stored PV length does not match the mate distance', () => {
    const fen = mateFen();
    // Mate value 3 needs a 5-ply full PV; a 1-ply PV is not that line.
    expect(fastPathVerifiedCandidate(rawCandidate(fen), source({ evalMate: 3 }), 0)).toBeNull();
    // Mate value 2 needs a 3-ply full PV; empty PV is never a mate line.
    expect(
      fastPathVerifiedCandidate(rawCandidate(fen), source({ evalMate: 2, bestPv: [] }), 0),
    ).toBeNull();
  });

  it('falls back when the mate distance exceeds the tactic window (>8 plies)', () => {
    const fen = mateFen();
    // A mate value of 5 is a 9-ply full PV — beyond MAX_TACTIC_PLIES.
    expect(fastPathVerifiedCandidate(rawCandidate(fen), source({ evalMate: 5 }), 0)).toBeNull();
  });

  it('falls back when the stored PV does not walk to checkmate', () => {
    const fen = mateFen();
    expect(
      fastPathVerifiedCandidate(rawCandidate(fen), source({ bestPv: ['d2d3'] }), 0),
    ).toBeNull();
  });

  it('falls back for a legal non-mate stored best line', () => {
    const fen = mateFen();
    // The user's own move (d2d3) is legal from the position but is not a mate.
    expect(
      fastPathVerifiedCandidate(rawCandidate(fen), source({ evalMate: null, bestPv: ['d2d3'] }), 0),
    ).toBeNull();
  });

  it('keeps the candidate id and scope unchanged', () => {
    const fen = mateFen();
    const verified = fastPathVerifiedCandidate(rawCandidate(fen), source(), 0)!;
    expect(verified.id).toBe('candidate-1');
    expect(verified.sourceGameId).toBe('game-1');
    expect(verified.sourcePly).toBe(6);
    expect(verified.analysisId).toBe('analysis-1');
    expect(verified.verificationStatus).toBe('verified');
  });

  it('records the stored analysis version, not the compile-time constant', () => {
    const fen = mateFen();
    const verified = fastPathVerifiedCandidate(
      rawCandidate(fen),
      source({ analysisVersion: 3 }),
      0,
    )!;
    expect(verified.verificationMetadata.analysisVersion).toBe(3);
  });
});
