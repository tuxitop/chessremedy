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
import { forcingness, materialDelta, walkLine } from './line';
import {
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

    // The stored difficulty is the ADR-025 estimate at the verification depth
    // (same inputs verifyCandidate fed the floor), replicated here so the test
    // does not hard-code the rounded value.
    const solutionWalk = walkLine(raw.startingFen, [...FORK_LINE]);
    if (!solutionWalk.ok) throw new Error('unreachable');
    const expectedDifficulty = estimateDifficulty({
      lineLength: 3,
      candidateFirstMoves: 1,
      forcingness: forcingness(solutionWalk.walk) * 100,
      evalSwing: Math.abs((topLine.evalCp ?? 0) - (raw.evalCpBefore ?? 0)),
      material: materialDelta(solutionWalk.walk),
      depth: DEPTH,
    });

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
      difficulty: expectedDifficulty,
      acceptedFirstMoves: ['g5f7'],
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

  it('allows a clearly-worse forcing alternative first move that would be near-best', () => {
    // Nxf7 (a capture, forcing) is clearly worse than the best line (+100 vs
    // +900): it survives both the alternative-move guard and the unicity gate
    // (plan 013 W2) and the candidate verifies.
    const input = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [
        makeLine({ multipv: 1, uci: ['h2h3'], evalCp: 900 }),
        makeLine({ multipv: 2, uci: ['g5f7'], evalCp: 100 }),
      ],
    });
    const verified = asVerified(verifyCandidate(input));

    expect(verified.tacticalObjective).toBe('decisive_advantage');
    expect(verified.candidateSolutionLength).toBe(1);
    expect(verified.verificationStatus).toBe('verified');
  });
});

describe('verifyCandidate — unicity gate (plan 013 W2)', () => {
  it('rejects when the best alternative is as good as the best move (ambiguous)', () => {
    // Two distinct first moves, both quiet and both reading decisive at +900:
    // the tactic is not unique.
    const input = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [
        makeLine({ multipv: 1, uci: ['h2h3'], evalCp: 900 }),
        makeLine({ multipv: 2, uci: ['g5f7'], evalCp: 900 }),
      ],
    });
    expectReason(input, 'best-move-not-unique');
  });

  it('rejects a near-equal second move below the winning-chance gap', () => {
    // Best h2h3 at +900 (≈ 0.947 winning chance) vs the forcing Nxf7 at +800
    // (≈ 0.922): the forcing alternative bypasses the alternative-move guard but
    // the winning-chance gap is far below UNICITY_MIN_WIN_CHANCE_GAP, so the
    // best move is not unique and the candidate is rejected.
    const input = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [
        makeLine({ multipv: 1, uci: ['h2h3'], evalCp: 900 }),
        makeLine({ multipv: 2, uci: ['g5f7'], evalCp: 800 }),
      ],
    });
    expectReason(input, 'best-move-not-unique');
  });

  it('never applies the unicity gate to a forcing-mate objective', () => {
    // 4.Qxf7# (h5f7) is a walked one-move board mate: a forcing_mate objective
    // skips the unicity gate (a mate is deterministic) and verifies even though
    // a quiet alternative (h2h3) reads decisive-near-equal.
    const mateFen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const input = verifyInput({
      candidate: makeCandidate({
        startingFen: mateFen,
        bestMove: 'h5f7',
        bestPv: ['h5f7'],
        evalCpBefore: null,
      }),
      lines: [
        makeLine({
          multipv: 1,
          uci: ['h5f7'],
          evalCp: null,
          evalMate: 1,
          wdl: { w: 1000, d: 0, l: 0 },
        }),
        makeLine({ multipv: 2, uci: ['h2h3'], evalCp: 900, wdl: { w: 950, d: 40, l: 10 } }),
      ],
    });
    const verified = asVerified(verifyCandidate(input));
    expect(verified.tacticalObjective).toBe('forcing_mate');
    expect(verified.candidateSolutionLength).toBe(1);
  });

  it('keeps the WDL-consistency guard reachable after the unicity gate', () => {
    // Top line unique (only line), so unicity is vacuous; the end WDL still
    // contradicts the winning_material objective and rejects.
    expectReason(
      verifyInput({
        lines: [makeLine({ wdl: { w: 100, d: 50, l: 850 } })],
      }),
      'wdl-inconsistent',
    );
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

describe('verifyCandidate — no ADR-025 difficulty rejection floor (owner decision)', () => {
  it('verifies a minimal (easy) tactic and still stores its difficulty', () => {
    // Surfacing a tactic the user genuinely missed never depends on how hard a
    // puzzle it would make: a single quiet decisive move (ADR-025 estimate
    // well below the old 15 floor) verifies and its difficulty is persisted.
    const minimal = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [makeLine({ uci: ['h2h3'], evalCp: 400 })],
    });
    const verified = asVerified(verifyCandidate(minimal));
    expect(verified.candidateSolutionLength).toBe(1);
    expect(verified.tacticalObjective).toBe('decisive_advantage');
    expect(typeof verified.difficulty).toBe('number');
  });

  it('verifies even a bare material win with no forcingness', () => {
    // An easy one-move queen grab (a3 rook takes the loose d3 queen):
    // forcingness 0 and a flat eval swing — still a verified missed tactic
    // (the old difficulty floor would have hidden it).
    const raw = makeCandidate({
      startingFen: '4k3/8/8/8/8/R2q4/8/4K3 w - - 0 1',
      evalCpBefore: 0,
      bestMove: 'a3d3',
      bestPv: ['a3d3'],
      userMovePlayed: 'h1h3',
    });
    const verified = asVerified(
      verifyCandidate(
        verifyInput({
          candidate: raw,
          lines: [makeLine({ uci: ['a3d3'], evalCp: 800, wdl: { w: 950, d: 40, l: 10 } })],
        }),
      ),
    );
    expect(verified.tacticalObjective).toBe('winning_material');
    expect(typeof verified.difficulty).toBe('number');
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

describe('verifyCandidate — persisted difficulty and accepted moves (Feature-011 follow-up)', () => {
  it('stores the difficulty and the best move as the only accepted move', () => {
    const raw = makeCandidate();
    const input = verifyInput({ candidate: raw, lines: [makeLine()] });
    const verified = asVerified(verifyCandidate(input));

    expect(typeof verified.difficulty).toBe('number');
    expect(verified.acceptedFirstMoves).toEqual(['g5f7']);
  });

  it('stores only moves whose own line reaches an objective (best always)', () => {
    // A clearly-worse forcing alternative (Nxf7 at +100) does not reach an
    // objective, so it is NOT an accepted solving move — the stored set stays
    // exactly the best move, matching the difficulty input's candidate count.
    const input = verifyInput({
      candidate: makeCandidate({ evalCpBefore: 0 }),
      lines: [
        makeLine({ multipv: 1, uci: ['h2h3'], evalCp: 900 }),
        makeLine({ multipv: 2, uci: ['g5f7'], evalCp: 100 }),
      ],
    });
    const verified = asVerified(verifyCandidate(input));
    expect(verified.acceptedFirstMoves).toEqual(['h2h3']);
  });

  it('persists objective-reaching accepted moves that survive the unicity gate', () => {
    // A far-worse forcing alternative that still neutralizes the same threat
    // (start already forced-lost at -800; both ends are fine) is far enough
    // below the best line in winning chance to survive the unicity gate, so
    // it is accepted alongside the best move.
    const input = verifyInput({
      candidate: makeCandidate({ evalCpBefore: -800 }),
      lines: [
        makeLine({ multipv: 1, uci: ['h2h3'], evalCp: 300 }),
        makeLine({ multipv: 2, uci: ['g5f7'], evalCp: -100 }),
      ],
    });
    const verified = asVerified(verifyCandidate(input));
    expect(verified.acceptedFirstMoves).toEqual(['h2h3', 'g5f7']);
    expect(verified.acceptedFirstMoves![0]).toBe('h2h3');
  });
});
