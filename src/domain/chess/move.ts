/**
 * Move reconstruction (Feature 003).
 *
 * chessops `PgnNodeData` stores only SAN, comments and NAGs. A domain `Move`
 * is a derived record produced deterministically by replaying the move tree
 * from the start position (ADR-028). Replay-derived helpers reject an illegal
 * SAN with an error instead of skipping or "fixing" it.
 */

import { makeFen } from 'chessops/fen';
import { castlingSide } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { kingCastlesTo, makeSquare, makeUci } from 'chessops/util';
import { isNormal, type Color, type NormalMove, type Role } from 'chessops/types';
import type { MoveList, NodePath, PgnNode } from './moveList';
import { mainlineNodes } from './moveList';
import { parsePositionFen, type Position } from './position';

export interface Move {
  readonly san: string;
  readonly uci: string;
  /** Origin square name, e.g. `e2`. */
  readonly from: string;
  /** Destination square name, e.g. `e4`. */
  readonly to: string;
  /** Promotion role when the move promotes a pawn (else `undefined`). */
  readonly promotion: Role | undefined;
  /** Side that made the move. */
  readonly color: Color;
  /** Full-move number as shown in the move list (1-based). */
  readonly fullMove: number;
  /** Number of moves already played in this line before this move (0-based). */
  readonly ply: number;
  /** Canonical FEN of the position before the move. */
  readonly fenBefore: string;
  /** Canonical FEN of the position after the move. */
  readonly fenAfter: string;
  /** PGN annotation glyphs (e.g. `4` for `??`). */
  readonly nags: readonly number[];
  /** Move-attached PGN comments (incl. a variation's starting comments). */
  readonly comments: readonly string[];
}

/** The mainline of a `MoveList` as derived `Move` records. */
export function mainlineMoves(list: MoveList): readonly Move[] {
  return movesForNodes(list, mainlineNodes(list));
}

/**
 * Moves along a child-index path. An empty path yields `[]`. Throws when the
 * path addresses a missing node or a SAN does not replay legally.
 */
export function movesToPath(list: MoveList, path: NodePath): readonly Move[] {
  return movesForNodes(list, pathNodes(list, path));
}

/** Position after the moves on a path (the start position for `[]`). */
export function positionAtPath(list: MoveList, path: NodePath): Position {
  const position = startPositionOf(list);
  let current = position;
  for (const child of pathNodes(list, path)) {
    const move = parseLegalMove(current, child.data.san, 0);
    const next = current.clone();
    next.play(move);
    current = next;
  }
  return current;
}

function startPositionOf(list: MoveList): Position {
  const resolved = parsePositionFen(list.startFen);
  if (!resolved.ok) {
    throw new Error(resolved.message);
  }
  return resolved.position;
}

function pathNodes(list: MoveList, path: NodePath): readonly PgnNode[] {
  const out: PgnNode[] = [];
  let node = list.root;
  for (const index of path) {
    const child = node.children[index];
    if (!child) {
      throw new Error(`No move at path index ${index}`);
    }
    out.push(child);
    node = child;
  }
  return out;
}

function parseLegalMove(position: Position, san: string, ply: number): NormalMove {
  let move;
  try {
    move = parseSan(position, san);
  } catch {
    move = undefined;
  }
  if (!move || !position.isLegal(move)) {
    throw new Error(`Illegal move (ply ${ply}): ${san}`);
  }
  if (!isNormal(move)) {
    throw new Error(`Unsupported move (ply ${ply}): ${san}`);
  }
  return move;
}

function movesForNodes(list: MoveList, nodes: readonly PgnNode[]): readonly Move[] {
  const position = startPositionOf(list);
  const out: Move[] = [];
  let current = position;
  for (let ply = 0; ply < nodes.length; ply += 1) {
    const child = nodes[ply]!;
    const san = child.data.san;
    const move = parseLegalMove(current, san, ply);
    const fenBefore = makeFen(current.toSetup());
    const color = current.turn;
    const fullMove = current.fullmoves;
    const display = displayOf(current, move);
    const next = current.clone();
    next.play(move);
    const fenAfter = makeFen(next.toSetup());
    out.push({
      san,
      ...display,
      promotion: move.promotion,
      color,
      fullMove,
      ply,
      fenBefore,
      fenAfter,
      nags: child.data.nags ?? [],
      comments: [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])],
    });
    current = next;
  }
  return out;
}

/**
 * Resolve the `from`/`to` squares and UCI for a move.
 *
 * chessops represents castling as king-captures-own-rook (`e1h1`). Engine
 * UCI and the move-list convention use the king's two-square target instead
 * (`e1g1`), so castling is normalized here for engine/PV compatibility.
 */
function displayOf(
  position: Position,
  move: NormalMove,
): { from: string; to: string; uci: string } {
  const side = castlingSide(position, move);
  if (side) {
    const from = makeSquare(move.from);
    const to = makeSquare(kingCastlesTo(position.turn, side));
    return { from, to, uci: `${from}${to}` };
  }
  const from = makeSquare(move.from);
  const to = makeSquare(move.to);
  return { from, to, uci: makeUci(move) };
}
