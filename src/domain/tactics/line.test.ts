/**
 * UCI line-walking tests (Feature 010). Deterministic fixtures only: real
 * positions replayed from the fixture corpus — the `li-blitz-blunder` Nxf7
 * fork, the `fx-sample-mate` / `li-bullet-missed-mate` mating motifs, the
 * `li-rapid-clean` queen exchange — plus the engine-verification FENs from
 * `src/infrastructure/engine/fixtures/enginePositions.ts` (en-passant,
 * hanging-rook, mate-in-1) and small hand-built terminal positions.
 */

import { describe, expect, it } from 'vitest';
import { fenOf, parsePositionFen } from '../chess/position';
import { forcingness, isTerminalDraw, lineTermination, materialDelta, walkLine } from './line';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const CASTLE_FEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
const EN_PASSANT_FEN = '4k3/8/8/3pPp2/8/8/8/4K3 w - f6 0 3';
const HANGING_ROOK_FEN = 'r3k3/5ppp/8/3Q4/8/8/5PPP/R5K1 w - - 0 1';
const MATE_IN_1_FEN = '6k1/5ppp/8/8/8/8/8/1R4K1 w - - 0 1';

// `fx-sample-mate`: position after 3...Nf6, before 4.Qxf7#.
const MATE_START_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

// `li-blitz-blunder`: position after 4...h6, before 5.Nxf7 (fork on Q+R).
const FORK_START_FEN = 'r1bqkb1r/pppp1pp1/2n2n1p/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5';
const FORK_LINE = ['g5f7', 'd8e7', 'f7h8'];

// `li-rapid-clean`: position after 7...Nf5, before 8.Qxd8+ Kxd8 (queen trade).
const QUEEN_TRADE_START_FEN = 'r1bqkb1r/ppp2ppp/2p5/4Pn2/8/5N2/PPP2PPP/RNBQ1RK1 w kq - 1 8';
const QUEEN_TRADE_LINE = ['d1d8', 'e8d8'];

function okWalk(fen: string, uciMoves: readonly string[]): ReturnType<typeof walkLine> {
  const result = walkLine(fen, uciMoves);
  expect(result.ok).toBe(true);
  return result;
}

describe('walkLine', () => {
  it('walks a quiet opening line and reports per-ply san/side/fen', () => {
    const result = okWalk(START_FEN, ['e2e4', 'e7e5', 'g1f3']);
    if (!result.ok) throw new Error('unreachable');
    const { plies, startTurn, final } = result.walk;
    expect(startTurn).toBe('white');
    expect(plies.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(plies.map((p) => p.sideToMoveBefore)).toEqual(['white', 'black', 'white']);
    expect(plies.map((p) => p.isCheck)).toEqual([false, false, false]);
    expect(plies.map((p) => p.isCapture)).toEqual([false, false, false]);
    expect(plies[0]!.fenAfter).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(final.turn).toBe('black');
    expect(final.material).toEqual({ white: 39, black: 39 });
    expect(final.termination).toBeNull();
    expect(parsePositionFen(final.fen).ok).toBe(true);
  });

  it('returns an empty walk for an empty move list', () => {
    const result = okWalk(FORK_START_FEN, []);
    if (!result.ok) throw new Error('unreachable');
    const { plies, startTurn, final } = result.walk;
    expect(plies).toEqual([]);
    expect(startTurn).toBe('white');
    expect(final.turn).toBe('white');
    expect(final.fen).toBe(FORK_START_FEN);
    expect(final.termination).toBeNull();
  });

  it('is deterministic across identical calls', () => {
    const first = walkLine(FORK_START_FEN, FORK_LINE);
    const second = walkLine(FORK_START_FEN, FORK_LINE);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.walk.plies).toEqual(first.walk.plies);
    expect(second.walk.final.fen).toBe(first.walk.final.fen);
    expect(second.walk.final.material).toEqual(first.walk.final.material);
    expect(second.walk.final.termination).toBe(first.walk.final.termination);
    expect(forcingness(second.walk)).toBe(forcingness(first.walk));
    expect(materialDelta(second.walk)).toBe(materialDelta(first.walk));
  });

  it('reports an invalid FEN as an error', () => {
    const result = walkLine('not-a-fen', ['e2e4']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Invalid FEN');
  });

  it('reports a malformed UCI token as an error', () => {
    const result = walkLine(START_FEN, ['zzz']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Invalid UCI');
  });

  it('reports an illegal move with its ply index', () => {
    const result = walkLine(START_FEN, ['e2e4', 'e7e5', 'e2e4']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('ply 2');
    if (!result.ok) expect(result.message).toContain('Illegal UCI');
  });

  it('reports an illegal first move as an error', () => {
    const result = walkLine(START_FEN, ['e2e5']);
    expect(result.ok).toBe(false);
  });
});

describe('capture and check detection', () => {
  it('flags the Nxf7 fork captures and the quiet reply (li-blitz-blunder)', () => {
    const result = okWalk(FORK_START_FEN, FORK_LINE);
    if (!result.ok) throw new Error('unreachable');
    const plies = result.walk.plies;
    expect(plies.map((p) => p.san)).toEqual(['Nxf7', 'Qe7', 'Nxh8']);
    expect(plies.map((p) => p.isCapture)).toEqual([true, false, true]);
    expect(plies.map((p) => p.capturedRole)).toEqual(['pawn', null, 'rook']);
    // The fork itself is a capture but not a check (king stays on e8).
    expect(plies.map((p) => p.isCheck)).toEqual([false, false, false]);
  });

  it('flags an en-passant capture as a pawn capture', () => {
    const result = okWalk(EN_PASSANT_FEN, ['e5f6']);
    if (!result.ok) throw new Error('unreachable');
    const ply = result.walk.plies[0]!;
    expect(ply.san).toBe('exf6');
    expect(ply.isCapture).toBe(true);
    expect(ply.capturedRole).toBe('pawn');
    expect(ply.isCheck).toBe(false);
  });

  it('does not flag castling (king-to-rook or two-square UCI) as a capture', () => {
    for (const move of ['e1g1', 'e1h1']) {
      const result = okWalk(CASTLE_FEN, [move]);
      if (!result.ok) throw new Error('unreachable');
      expect(result.walk.plies[0]!.san).toBe('O-O');
      expect(result.walk.plies[0]!.isCapture).toBe(false);
      expect(result.walk.plies[0]!.capturedRole).toBeNull();
    }
  });

  it('does not flag a promotion as a capture', () => {
    const fen = '8/4P3/k7/8/8/8/8/4K3 w - - 0 1';
    const result = okWalk(fen, ['e7e8q']);
    if (!result.ok) throw new Error('unreachable');
    expect(result.walk.plies[0]!.san).toBe('e8=Q');
    expect(result.walk.plies[0]!.isCapture).toBe(false);
    expect(result.walk.plies[0]!.capturedRole).toBeNull();
  });

  it('flags a checking capture and the recapture (li-rapid-clean queen trade)', () => {
    const result = okWalk(QUEEN_TRADE_START_FEN, QUEEN_TRADE_LINE);
    if (!result.ok) throw new Error('unreachable');
    const [checkCapture, recapture] = result.walk.plies;
    expect(checkCapture!.san).toBe('Qxd8+');
    expect(checkCapture!.isCheck).toBe(true);
    expect(checkCapture!.isCapture).toBe(true);
    expect(checkCapture!.capturedRole).toBe('queen');
    expect(recapture!.san).toBe('Kxd8');
    expect(recapture!.isCheck).toBe(false);
    expect(recapture!.isCapture).toBe(true);
    expect(recapture!.capturedRole).toBe('queen');
  });

  it('flags a quiet mating move as a check (engine-mate-in-1, Rb8#)', () => {
    const result = okWalk(MATE_IN_1_FEN, ['b1b8']);
    if (!result.ok) throw new Error('unreachable');
    const ply = result.walk.plies[0]!;
    expect(ply.san).toBe('Rb8#');
    expect(ply.isCheck).toBe(true);
    expect(ply.isCapture).toBe(false);
  });
});

describe('forcingness', () => {
  it('is 0 for an empty line', () => {
    const result = okWalk(FORK_START_FEN, []);
    if (!result.ok) throw new Error('unreachable');
    expect(forcingness(result.walk)).toBe(0);
  });

  it('is 0 for a quiet line', () => {
    const result = okWalk(START_FEN, ['e2e4', 'e7e5', 'g1f3']);
    if (!result.ok) throw new Error('unreachable');
    expect(forcingness(result.walk)).toBe(0);
  });

  it('is the share of forcing plies for the fork line (capture, quiet, capture)', () => {
    const result = okWalk(FORK_START_FEN, FORK_LINE);
    if (!result.ok) throw new Error('unreachable');
    expect(forcingness(result.walk)).toBeCloseTo(2 / 3, 10);
  });

  it('is 1 when every ply is a check or capture (queen trade)', () => {
    const result = okWalk(QUEEN_TRADE_START_FEN, QUEEN_TRADE_LINE);
    if (!result.ok) throw new Error('unreachable');
    expect(forcingness(result.walk)).toBe(1);
  });

  it('is 1 for a single-ply forcing line', () => {
    const result = okWalk(HANGING_ROOK_FEN, ['d5a8']);
    if (!result.ok) throw new Error('unreachable');
    expect(forcingness(result.walk)).toBe(1);
  });
});

describe('materialDelta', () => {
  it('returns 0 for an empty or quiet line', () => {
    for (const [fen, moves] of [
      [FORK_START_FEN, []],
      [START_FEN, ['e2e4', 'e7e5', 'g1f3']],
    ] as const) {
      const result = okWalk(fen, [...moves]);
      if (!result.ok) throw new Error('unreachable');
      expect(materialDelta(result.walk)).toBe(0);
    }
  });

  it('is positive for the capture-heavy Nxf7 fork (pawn + rook = 6)', () => {
    const result = okWalk(FORK_START_FEN, FORK_LINE);
    if (!result.ok) throw new Error('unreachable');
    expect(materialDelta(result.walk)).toBe(6);
  });

  it('is +5 for winning the hanging rook (engine-hanging-rook, Qxa8+)', () => {
    const result = okWalk(HANGING_ROOK_FEN, ['d5a8']);
    if (!result.ok) throw new Error('unreachable');
    expect(materialDelta(result.walk)).toBe(5);
  });

  it('is 0 for an equal queen exchange', () => {
    const result = okWalk(QUEEN_TRADE_START_FEN, QUEEN_TRADE_LINE);
    if (!result.ok) throw new Error('unreachable');
    expect(materialDelta(result.walk)).toBe(0);
  });

  it('is +1 for an en-passant capture', () => {
    const result = okWalk(EN_PASSANT_FEN, ['e5f6']);
    if (!result.ok) throw new Error('unreachable');
    expect(materialDelta(result.walk)).toBe(1);
  });

  it('stays positive for the starting mover when that mover is Black', () => {
    const fen = '3r2k1/8/8/8/8/8/3Q4/K7 b - - 0 1';
    const result = okWalk(fen, ['d8d2']);
    if (!result.ok) throw new Error('unreachable');
    expect(result.walk.startTurn).toBe('black');
    expect(materialDelta(result.walk)).toBe(9);
  });
});

describe('terminal detection', () => {
  it('detects checkmate on Qxf7# (fx-sample-mate)', () => {
    const result = okWalk(MATE_START_FEN, ['h5f7']);
    if (!result.ok) throw new Error('unreachable');
    const { plies, final } = result.walk;
    expect(plies[0]!.san).toBe('Qxf7#');
    expect(plies[0]!.isCheck).toBe(true);
    expect(plies[0]!.isCapture).toBe(true);
    expect(plies[0]!.capturedRole).toBe('pawn');
    expect(final.termination).toBe('checkmate');
    expect(final.turn).toBe('black');
  });

  it('detects stalemate in a terminal position', () => {
    const fen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    const result = okWalk(fen, []);
    if (!result.ok) throw new Error('unreachable');
    expect(result.walk.final.termination).toBe('stalemate');
  });

  it('detects insufficient material (bare kings)', () => {
    const fen = '8/8/8/4k3/8/8/8/4K3 w - - 0 1';
    const result = okWalk(fen, []);
    if (!result.ok) throw new Error('unreachable');
    expect(result.walk.final.termination).toBe('insufficient-material');
  });

  it('detects the fifty-move rule from the halfmove clock', () => {
    const fen = '6k1/8/8/8/8/8/5R2/6K1 w - - 100 1';
    const result = okWalk(fen, []);
    if (!result.ok) throw new Error('unreachable');
    expect(result.walk.final.termination).toBe('fifty-move');
  });

  it('exposes board-state helpers that agree with the walk result', () => {
    const mate = okWalk(MATE_START_FEN, ['h5f7']);
    const stale = okWalk('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', []);
    const fifty = okWalk('6k1/8/8/8/8/8/5R2/6K1 w - - 100 1', []);
    const open = okWalk(FORK_START_FEN, []);
    if (!mate.ok) throw new Error('unreachable');
    if (!stale.ok) throw new Error('unreachable');
    if (!fifty.ok) throw new Error('unreachable');
    if (!open.ok) throw new Error('unreachable');
    for (const walk of [mate.walk, stale.walk, fifty.walk, open.walk]) {
      expect(lineTermination(walk.final.position)).toBe(walk.final.termination);
    }
    expect(isTerminalDraw(stale.walk.final.position)).toBe(true);
    expect(isTerminalDraw(fifty.walk.final.position)).toBe(true);
    expect(isTerminalDraw(mate.walk.final.position)).toBe(false);
    expect(isTerminalDraw(open.walk.final.position)).toBe(false);
    expect(lineTermination(open.walk.final.position)).toBeNull();
    expect(fenOf(mate.walk.final.position)).toBe(mate.walk.final.fen);
  });
});
