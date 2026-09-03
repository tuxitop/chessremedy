import { describe, expect, it } from 'vitest';
import { parsePgn } from 'chessops/pgn';
import { fenOf, resolveStartPosition } from './position';
import { createMoveList } from './moveList';
import type { MoveList } from './moveList';
import { mainlineMoves, movesToPath, positionAtPath } from './move';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function listOf(pgn: string): MoveList {
  const game = parsePgn(pgn)[0];
  if (!game) {
    throw new Error('No game parsed');
  }
  const start = resolveStartPosition(game.headers);
  if (!start.ok) {
    throw new Error(start.message);
  }
  return createMoveList(game.moves, fenOf(start.position));
}

describe('mainlineMoves', () => {
  it('derives san/uci/from/to/color/fullMove/ply for every ply', () => {
    const moves = mainlineMoves(
      listOf('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 d6 6. Nc3 O-O'),
    );
    expect(moves).toHaveLength(12);
    expect(moves[0]).toMatchObject({
      san: 'e4',
      uci: 'e2e4',
      from: 'e2',
      to: 'e4',
      color: 'white',
      fullMove: 1,
      ply: 0,
      fenBefore: START_FEN,
    });
    expect(moves[1]!.color).toBe('black');
    expect(moves[1]!.fullMove).toBe(1);
  });

  it('derives castling from/to and uci', () => {
    const moves = mainlineMoves(
      listOf('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 d6 6. Nc3 O-O'),
    );
    const whiteCastle = moves[6]!;
    expect(whiteCastle.san).toBe('O-O');
    expect(whiteCastle.uci).toBe('e1g1');
    expect(whiteCastle.from).toBe('e1');
    expect(whiteCastle.to).toBe('g1');
    expect(whiteCastle.color).toBe('white');
    expect(whiteCastle.fullMove).toBe(4);
    const blackCastle = moves[11]!;
    expect(blackCastle.san).toBe('O-O');
    expect(blackCastle.uci).toBe('e8g8');
    expect(blackCastle.color).toBe('black');
  });

  it('derives a capturing queen move', () => {
    const moves = mainlineMoves(listOf('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#'));
    expect(moves).toHaveLength(7);
    const mate = moves[6]!;
    expect(mate.san).toBe('Qxf7#');
    expect(mate.from).toBe('h5');
    expect(mate.to).toBe('f7');
    expect(mate.uci).toBe('h5f7');
    expect(mate.promotion).toBeUndefined();
  });

  it('derives a promotion from a FEN start position', () => {
    const moves = mainlineMoves(
      listOf('[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/8/6K1 w - - 0 1"]\n\n1. a8=Q+'),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]!.san).toBe('a8=Q+');
    expect(moves[0]!.uci).toBe('a7a8q');
    expect(moves[0]!.from).toBe('a7');
    expect(moves[0]!.to).toBe('a8');
    expect(moves[0]!.promotion).toBe('queen');
    expect(moves[0]!.fenBefore).toBe('8/P6k/8/8/8/8/8/6K1 w - - 0 1');
  });

  it('keeps fenAfter of a ply equal to fenBefore of the next ply', () => {
    const moves = mainlineMoves(listOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6'));
    for (let i = 0; i < moves.length - 1; i += 1) {
      expect(moves[i]!.fenAfter).toBe(moves[i + 1]!.fenBefore);
    }
  });

  it('rejects an illegal SAN before returning moves', () => {
    const list = listOf('1. Qe5+ Kd8');
    expect(() => mainlineMoves(list)).toThrow(/Illegal move/);
  });
});

describe('movesToPath & positionAtPath', () => {
  const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4';
  const list = listOf(pgn);

  it('returns [] for the start path and follows a child-index path', () => {
    expect(movesToPath(list, [])).toEqual([]);
    const six = movesToPath(list, [0, 0, 0, 0, 0, 0]);
    expect(six.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(six[5]!.ply).toBe(5);
  });

  it('reaches a variation via its path', () => {
    const variation = movesToPath(list, [0, 0, 0, 0, 1]);
    expect(variation.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
  });

  it('computes the position at the end of a path', () => {
    expect(positionAtPath(list, []).turn).toBe('white');
    const afterBc4 = positionAtPath(list, [0, 0, 0, 0, 1]);
    expect(afterBc4.turn).toBe('black');
    expect(fenOf(afterBc4)).toBe(movesToPath(list, [0, 0, 0, 0, 1]).at(-1)!.fenAfter);
  });

  it('throws for a nonexistent path', () => {
    expect(() => movesToPath(list, [0, 9])).toThrow(/No move at path index 9/);
    expect(() => positionAtPath(list, [1])).toThrow();
  });
});
