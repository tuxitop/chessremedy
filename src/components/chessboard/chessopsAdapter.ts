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

export function sanOf(position: Position, move: Parameters<typeof makeSan>[1]): string {
  return makeSan(position, move);
}

export function turnColor(position: Position): Color {
  return position.turn;
}
