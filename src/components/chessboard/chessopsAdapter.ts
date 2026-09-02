import { Chess, type Position } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { chessgroundDests } from 'chessops/compat';
import { parseSan, makeSan } from 'chessops/san';
import { parseSquare } from 'chessops/util';
import type { Color, Dests, Key } from '@lichess-org/chessground/types';
import type { Move, Square } from 'chessops/types';

/**
 * Adapter between chessops (chess rules, position) and Chessground
 * (board renderer).
 *
 * ChessRemedy's domain uses chessops exclusively; Chessground accepts
 * only FEN strings and `Dests` maps keyed by Chessground `Key` values
 * (`a1`..`h8`). The adapter keeps the two worlds separate so the
 * domain never imports `@lichess-org/chessground` types and the board
 * wrapper never imports `chessops` types.
 */

export interface ChessOpsInit {
  readonly position: Position;
}

export type ChessOpsPosition = Position;
export type ChessOpsColor = Color;
export type ChessOpsKey = Key;

export function positionFromFen(fen: string): Position {
  const setup = parseFen(fen);
  if (setup.isErr) {
    throw new Error(`Invalid FEN: ${fen}`);
  }
  const result = Chess.fromSetup(setup.value);
  if (result.isErr) {
    throw new Error(`Invalid chess setup from FEN: ${fen}`);
  }
  return result.value;
}

export function positionToFen(position: Position): string {
  return makeFen(position.toSetup());
}

export function startingPosition(): Position {
  return Chess.default();
}

/** Legal-move destinations in Chessground's `Dests` shape. */
export function chessgroundDestsFromPosition(position: Position): Dests {
  const map = chessgroundDests(position);
  const out = new Map<Key, Key[]>();
  for (const [from, dests] of map.entries()) {
    out.set(
      from as Key,
      Array.from(dests, (d) => d as Key),
    );
  }
  return out;
}

/**
 * Apply a chessground move (`from` + `to` + optional promotion) to a
 * chessops position. Returns the new position, or `null` if the move
 * is illegal.
 */
export function applyChessgroundMove(
  position: Position,
  from: Key,
  to: Key,
  promotion?: 'queen' | 'knight' | 'rook' | 'bishop',
): Position | null {
  const move: Move = promotion
    ? { from: parseSquare(from) as Square, to: parseSquare(to) as Square, promotion }
    : { from: parseSquare(from) as Square, to: parseSquare(to) as Square };
  if (!position.isLegal(move)) {
    return null;
  }
  const next = position.clone();
  next.play(move);
  return next;
}

/** Parse a SAN string and apply it to the position. */
export function applySan(position: Position, san: string): Position | null {
  const move = parseSan(position, san);
  if (!move || !position.isLegal(move)) {
    return null;
  }
  const next = position.clone();
  next.play(move);
  return next;
}

/**
 * Apply a chessground move and return both the resulting position AND
 * the SAN string for the move. The SAN is the canonical representation
 * the UI displays in the move list; the position is the post-move
 * chessops state.
 */
export function applyChessgroundMoveWithSan(
  position: Position,
  from: Key,
  to: Key,
  promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
): { position: Position; san: string } | null {
  const move: Move = {
    from: parseSquare(from as string) as Square,
    to: parseSquare(to as string) as Square,
    ...(promotion ? { promotion } : {}),
  };
  if (!position.isLegal(move)) {
    return null;
  }
  const san = makeSan(position, move);
  const next = position.clone();
  next.play(move);
  return { position: next, san };
}

export function sanOf(position: Position, move: Parameters<typeof makeSan>[1]): string {
  return makeSan(position, move);
}

export function turnColor(position: Position): Color {
  return position.turn;
}

/** Chessground key (`a1`-`h8`) for a chessops square index. */
export function squareKey(square: Square): Key {
  const file = square & 7;
  const rank = square >> 3;
  return `${'abcdefgh'[file]}${rank + 1}` as Key;
}

/** Board square index for a Chessground key. */
export function parseSquareKey(key: Key): Square {
  return parseSquare(key) as Square;
}

/** Square of the given color's king, or `null` when absent. */
export function kingSquare(position: Position, color: Color): Key | null {
  for (const [square, piece] of position.board) {
    if (piece.role === 'king' && piece.color === color) {
      return squareKey(square);
    }
  }
  return null;
}
