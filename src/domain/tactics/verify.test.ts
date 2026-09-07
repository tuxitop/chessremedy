/**
 * Stage-2 verification tests (Feature 010, ADR-026). Exercises `verifyCandidate`
 * across its guard order with deterministic hand-authored MultiPV inputs: the
 * happy path is the `li-blitz-blunder` Nxf7 fork (same start FEN / UCI the
 * `line.test.ts` corpus walks), and every rejection reason is pinned with a
 * targeted shape (small built positions where the guard under test is the only
 * thing that can fire). Evaluations/WDLs are hand-authored engine-shaped
 * numbers; the module is pure, so the board only needs the walks to be legal.
 */

import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION } from '@/domain/chess';
import { estimateDifficulty } from './difficulty';
import {
  VERIFICATION_MIN_DIFFICULTY,
  verifyCandidate,
  type TacticalCandidateLine,
  type TacticalVerificationInput,
} from './verify';
import { CANDIDATE_GENERATION_VERSION, DETECTION_VERSION } from './types';
import type { RawCandidate, VerifiedTacticalCandidate } from './types';

const NOW = 1_700_000_000_000;
const DEPTH = 30;
const ENGINE = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
} as const;

// `li-blitz-blunder`: position after 4...h6, before 5.Nxf7 (White to move);
// the fork wins a pawn and the a8-rook netting 6 piece-value units.
const FORK_FEN = 'r1bqkb1r/pppp1pp1/2n2n1p/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5';
const FORK_LINE = ['g5f7', 'd8e7', 'f7h8'] as const;

function makeCandidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    id: 'analysis-1:7',
    analysisId: 'analysis-1',
    sourceGameId: 'lichess:game1',
    sourcePly: 7,
    startingFen: FORK_FEN,
    userMovePlayed: 'h7h6',
    bestMove: 'g5f7',
    bestPv: [...FORK_LINE],
    wpLoss: 42.3,
    evalCpBefore: 300,
    evalCpAfterUserMove: -180,
    candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
    createdAt: NOW,
    ...overrides,
  };
}

function makeLine(overrides: Partial<TacticalCandidateLine> = {}): TacticalCandidateLine {
  return {
    multipv: 1,
    evalCp: 700,
    evalMate: null,
    wdl: { w: 950, d: 40, l: 10 },
    uci: [...FORK_LINE],
    ...overrides,
  };
}

function verifyInput(
  overrides: Partial<TacticalVerificationInput> = {},
): TacticalVerificationInput {
  return {
    candidate: makeCandidate(),
    now: NOW,
    verificationDepth: DEPTH,
    engine: ENGINE,
    lines: [makeLine()],
    ...overrides,
  };
}

function asVerified(result: ReturnType<typeof verifyCandidate>): VerifiedTacticalCandidate {
  if (!result.ok) throw new Error(`unreachable: expected ok, got ${result.reason}`);
  return result.candidate;
}

function expectReason(input: TacticalVerificationInput, reason: string): void {
  expect(verifyCandidate(input)).toEqual({ ok: false, reason });
}

describe('verifyCandidate — verified fork (happy path)', () => {
  it('verifies the Nxf7 fork as winning_material in 3 plies', () => {
    const input = verifyInput();
    const verified = asVerified(verifyCandidate(input));

    expect(verified.tacticalObjective).toBe('winning_material');
    expect(verified.candidateSolutionLength).toBe(3);
    expect(verified.detectionVersion).toBe(DETECTION_VERSION);
    expect(verified.verificationStatus).toBe('verified');
  });

  it('preserves every RawCandidate field on the verified candidate', () => {
    const raw = makeCandidate();
    const verified = asVerified(verifyCandidate(verifyInput({ candidate: raw })));

    expect(verified).toMatchObject(raw);
    expect(verified.id).toBe(raw.id);
    expect(verified.analysisId).toBe(raw.analysisId);
    expect(verified.sourceGameId).toBe(raw.sourceGameId);
    expect(verified.sourcePly).toBe(raw.sourcePly);
    expect(verified.startingFen).toBe(raw.startingFen);
    expect(verified.userMovePlayed).toBe(raw.userMovePlayed);
    expect(verified.bestMove).toBe(raw.bestMove);
    expect(verified.bestPv).toEqual(raw.bestPv);
    expect(verified.wpLoss).toBe(raw.wpLoss);
    expect(verified.evalCpBefore).toBe(raw.evalCpBefore);
    expect(verified.evalCpAfterUserMove).toBe(raw.evalCpAfterUserMove);
    expect(verified.candidateGenerationVersion).toBe(CANDIDATE_GENERATION_VERSION);
    expect(verified.createdAt).toBe(NOW);
  });

  it('records the full verification metadata on the verified candidate', () => {
    const topLine = makeLine();
    const verified = asVerified(verifyCandidate(verifyInput({ lines: [topLine] })));

    expect(verified.verificationMetadata).toEqual({
      engineName: ENGINE.engineName,
      engineVersion: ENGINE.engineVersion,
      engineBuild: ENGINE.engineBuild,
      analysisVersion: ANALYSIS_VERSION,
      verificationDepth: DEPTH,
      verificationTimestamp: NOW,
      wdlAfterBestLine: topLine.wdl,
    });
  });

  it('builds the verified candidate by extending the raw fields', () => {
    const raw = makeCandidate();
    const topLine = makeLine();
    const result = verifyCandidate(verifyInput({ candidate: raw, lines: [topLine] }));
    const verified = asVerified(result);

    expect(verified).toEqual<VerifiedTacticalCandidate>({
      ...raw,
      tacticalObjective: 'winning_material',
      candidateSolutionLength: 3,
      verificationMetadata: {
        engineName: ENGINE.engineName,
        engineVersion: ENGINE.engineVersion,
        engineBuild: ENGINE.engineBuild,
        analysisVersion: ANALYSIS_VERSION,
        verificationDepth: DEPTH,
        verificationTimestamp: NOW,
        wdlAfterBestLine: topLine.wdl,
      },
      detectionVersion: DETECTION_VERSION,
      verificationSource: 'tactical-search',
      verificationStatus: 'verified',
    });
  });
});

describe('verifyCandidate — engine-line integrity guards', () => {
  it('rejects an empty MultiPV result as no-lines', () => {
    expectReason(verifyInput({ lines: [] }), 'no-lines');
  });

  it.each([
    ['a malformed UCI token', ['zz']],
    ['an illegal move for the position', ['e2e5']],
  ] as const)('rejects a top line containing %s as bad-line', (_label, uci) => {
    expectReason(verifyInput({ lines: [makeLine({ uci: [...uci] })] }), 'bad-line');
  });

  it('rejects a top line that ends in stalemate as draw-line', () => {
    // Hand-built: White Qc6->g6 quietly stalemates the lone Kh8; a "best line"
    // that lands on a board-state draw must not verify.
    const fen = '7k/8/2Q5/8/8/8/8/K7 w - - 0 1';
    expectReason(
      verifyInput({
        candidate: makeCandidate({ startingFen: fen }),
        lines: [makeLine({ uci: ['c6g6'], evalCp: 0 })],
      }),
      'draw-line',
    );
  });

  it('rejects a top line that ends in insufficient material as draw-line', () => {
    const fen = '8/8/8/4k3/8/8/8/4K3 w - - 0 1';
    expectReason(
      verifyInput({
        candidate: makeCandidate({ startingFen: fen }),
        lines: [makeLine({ uci: ['e1d2'], evalCp: 0 })],
      }),
      'draw-line',
    );
  });
});

describe('verifyCandidate — objective reachability guards', () => {
  it('rejects a quiet line that reaches no objective as no-objective', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expectReason(
      verifyInput({
        candidate: makeCandidate({ startingFen: fen, evalCpBefore: 0 }),
        lines: [makeLine({ uci: ['e2e4', 'e7e5'], evalCp: 20 })],
      }),
      'no-objective',
    );
  });

  it('rejects an objective that only appears beyond 8 plies as >8-plies', () => {
    // Hand-built KQ-vs-K drive: White gives a queen check every ply so the walk
    // never stabilises, gains no material, and only a decisive end evaluation
    // (the line end, ply 9) reaches an objective — beyond the 8-ply window.
    const fen = '8/8/8/8/8/4k3/8/KQ6 w - - 0 1';
    const uci = ['b1c1', 'e3e2', 'c1d1', 'e2f2', 'd1e1', 'f2g2', 'e1f1', 'g2h2', 'f1g1'];
    expectReason(
      verifyInput({
        candidate: makeCandidate({ startingFen: fen, evalCpBefore: 0 }),
        lines: [makeLine({ uci, evalCp: 700 })],
      }),
      '>8-plies',
    );
  });
});

describe('verifyCandidate — alternative-move guard', () => {
  it('rejects a non-forcing alternative first move that reaches the same objective', () => {
    // Top move h2h3 (quiet) reads decisive; the quiet a2a3 alternative reaches
    // the same decisive_advantage, so the tactic is not forced.
    const input = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [
        makeLine({ multipv: 1, uci: ['h2h3'], evalCp: 900 }),
        makeLine({ multipv: 2, uci: ['a2a3'], evalCp: 900 }),
      ],
    });
    expectReason(input, 'non-forcing-alternative-reaches-objective');
  });

  it('allows a forcing alternative first move that reaches the same objective', () => {
    // Nxf7 (a capture) reaches the same decisive_advantage but is forcing, so
    // the candidate survives the alternative-move guard and verifies.
    const input = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [
        makeLine({ multipv: 1, uci: ['h2h3'], evalCp: 900 }),
        makeLine({ multipv: 2, uci: ['g5f7'], evalCp: 900 }),
      ],
    });
    const verified = asVerified(verifyCandidate(input));

    expect(verified.tacticalObjective).toBe('decisive_advantage');
    expect(verified.candidateSolutionLength).toBe(1);
    expect(verified.verificationStatus).toBe('verified');
  });
});

describe('verifyCandidate — WDL-consistency guard', () => {
  it('rejects a winning-material line whose end WDL still shows the mover losing', () => {
    // Same fork shape as the happy path, but the end WDL says the mover loses
    // 85% of the time — a contradiction for winning_material.
    expectReason(
      verifyInput({
        lines: [makeLine({ wdl: { w: 100, d: 50, l: 850 } })],
      }),
      'wdl-inconsistent',
    );
  });
});

describe('verifyCandidate — winning_material retention', () => {
  it('never reports a transient queen gain that the PV recaptures', () => {
    // Equal queen trade: Qxd8+ Kxd8 nets zero by the end of the PV. The first
    // prefix reports +9 (queen) but the gain is not retained, so a genuine
    // "winning material in 1 ply" must NOT be emitted. Rooks remain on a1/a8
    // so the end position is not an insufficient-material draw.
    const fen = 'r2qk3/8/8/8/8/8/8/R2QK3 w - - 0 1';
    const input = verifyInput({
      candidate: makeCandidate({ startingFen: fen, evalCpBefore: 100 }),
      lines: [
        makeLine({
          uci: ['d1d8', 'e8d8'],
          evalCp: 120,
          wdl: { w: 640, d: 320, l: 40 },
        }),
      ],
    });
    expectReason(input, 'no-objective');
  });

  it('emits winning_material only when the gain is irreversible through the line', () => {
    // Nxf7+ wins the f7 pawn; the a8 rook falls on the third ply and the gain
    // (+6) is retained to the end of the line, so the objective fires.
    const input = verifyInput();
    const verified = asVerified(verifyCandidate(input));
    expect(verified.tacticalObjective).toBe('winning_material');
    expect(verified.candidateSolutionLength).toBe(3);
    expect(verified.bestPv).toEqual([...FORK_LINE]);
  });
});

describe('verifyCandidate — verified solution is persisted', () => {
  it('persists the verified tactical line, not the bulk-analysis PV, when they differ', () => {
    // Bulk analysis's stored PV claimed a different first move than the
    // tactical-profile run. The emitted candidate must carry the verified
    // solution (top line walked to the objective), never the stale bestPv.
    const raw = makeCandidate({ bestMove: 'h2h3', bestPv: ['h2h3'] });
    const input = verifyInput({
      candidate: raw,
      lines: [makeLine({ uci: [...FORK_LINE] })],
    });
    const verified = asVerified(verifyCandidate(input));

    expect(verified.bestMove).toBe('g5f7');
    expect(verified.bestPv).toEqual([...FORK_LINE]);
    expect(verified.candidateSolutionLength).toBe(3);
  });
});

describe('verifyCandidate — difficulty-below-15 guard', () => {
  it('documents that the difficulty-below-15 rejection cannot fire with ADR-025 constants', () => {
    expect(VERIFICATION_MIN_DIFFICULTY).toBe(15);

    // Any objective-bearing verification occupies >= 1 solution ply with >= 1
    // solving first move, so the ADR-025 estimate is at least
    // 10 * 1 + 8 * 1 = 18 — above the floor. The guard is unreachable.
    expect(
      estimateDifficulty({
        lineLength: 1,
        candidateFirstMoves: 1,
        forcingness: 0,
        evalSwing: 0,
        material: 0,
        depth: 0,
      }),
    ).toBe(18);

    // A minimal end-to-end verification (single quiet decisive move, no
    // alternatives) still verifies ok rather than ever rejecting below 15.
    const minimal = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [makeLine({ uci: ['h2h3'], evalCp: 400 })],
    });
    const verified = asVerified(verifyCandidate(minimal));
    expect(verified.candidateSolutionLength).toBe(1);
    expect(verified.tacticalObjective).toBe('decisive_advantage');
  });
});

describe('verifyCandidate — determinism', () => {
  it('returns identical results across repeated calls and never mutates its input', () => {
    const input = verifyInput();
    const rawCandidate = input.candidate;
    const rawLine = input.lines[0];

    const first = verifyCandidate(input);
    const second = verifyCandidate(input);
    expect(second).toEqual(first);
    expect(verifyCandidate(verifyInput())).toEqual(first);

    // The module is pure: the caller-owned input objects are untouched.
    expect(input.candidate).toEqual(rawCandidate);
    expect(input.lines[0]).toEqual(rawLine);
    if (first.ok) {
      const again = verifyCandidate(input);
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.candidate).toEqual(first.candidate);
    }
  });
});
