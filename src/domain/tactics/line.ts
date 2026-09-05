/**
 * UCI line walking for tactical verification (Feature 010, ADR-026).
 *
 * Pure, deterministic replay helpers over a UCI move list applied to a
 * starting FEN using chessops (ADR-028). Stage-2 verification (research
 * `tactical-detection.md` §3) walks each engine principal variation from the
 * candidate's starting position and needs, per ply, whether the ply was a
 * check and/or a capture plus an end-of-line terminal/material picture, then
 * derives the forcingness metric (§4) and the material delta (§3 step 3).
 *
 * All functions are framework-free, deterministic and never throw: invalid
 * FENs / UCI tokens / illegal moves surface as error-shaped results, mirroring
 * `uciPvToSan` in `src/domain/chess/san.ts`. Threefold repetition is out of
 * scope here — the orchestrator supplies the repetition context; this module
 * only reports the board-state terminals (checkmate, stalemate, insufficient
 * material, fifty-move rule) reachable from a Position alone.
 */

import { makeSan } from 'chessops/san';
import { isNormal } from 'chessops/types';
import type { Color, NormalMove, Role } from 'chessops/types';
import { parseUci } from 'chessops/util';
import { fenOf, parsePositionFen, type Position } from '../chess/position';

/** Board-state terminal results this module can detect (§8 edge cases). */
export type LineTermination = 'checkmate' | 'stalemate' | 'insufficient-material' | 'fifty-move';

/** Piece material on the board, in piece-value units (P=1 N=3 B=3 R=5 Q=9). */
export interface MaterialBalance {
  readonly white: number;
  readonly black: number;
}

/** Material value of each role; kings are never capturable, so 0. */
const ROLE_VALUE: Readonly<Record<Role, number>> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

function pieceValue(role: Role): number {
  return ROLE_VALUE[role];
}

/**
 * A single replayed ply of a line. `isCheck` is whether the mover's move gave
 * check (the resulting position's side to move is in check); `isCapture` and
 * `capturedRole` describe a capture performed by the ply. A ply that is both a
 * check and a capture reports both (the union of the two is the forcingness
 * input; see `forcingness`).
 */
export interface LinePly {
  /** Zero-based ply index within the walked line. */
  readonly plyIndex: number;
  /** The UCI token as given. */
  readonly moveUci: string;
  /** SAN rendering of the move (chessops `makeSan`, incl. `+`/`#` suffixes). */
  readonly san: string;
  /** Side to move before the ply — the mover. */
  readonly sideToMoveBefore: Color;
  readonly isCheck: boolean;
  readonly isCapture: boolean;
  /** Piece type captured by the ply, or `null` for a non-capture. */
  readonly capturedRole: Role | null;
  /** Canonical FEN of the position after the ply. */
  readonly fenAfter: string;
}

/** Position after the final ply of a walked line. */
export interface LineEnd {
  /** A snapshot of the chessops `Position` (independent of the walker). */
  readonly position: Position;
  /** Canonical FEN of the final position. */
  readonly fen: string;
  /** Side to move in the final position. */
  readonly turn: Color;
  /** Material on the board in the final position, per side. */
  readonly material: MaterialBalance;
  /** Board-state terminal reached, or `null` when the line is not terminal. */
  readonly termination: LineTermination | null;
}

/** A successful line walk: the replayed plies plus the end position. */
export interface LineWalk {
  /** The starting FEN as given to `walkLine`. */
  readonly startFen: string;
  /** Side to move at the start of the line (the line's starting mover). */
  readonly startTurn: Color;
  readonly plies: readonly LinePly[];
  readonly final: LineEnd;
}

export type LineWalkResult =
  { readonly ok: true; readonly walk: LineWalk } | { readonly ok: false; readonly message: string };

/** Board-state terminal of a position, or `null` when play could continue. */
export function lineTermination(position: Position): LineTermination | null {
  if (position.isCheckmate()) {
    return 'checkmate';
  }
  if (position.isStalemate()) {
    return 'stalemate';
  }
  if (position.isInsufficientMaterial()) {
    return 'insufficient-material';
  }
  if (position.halfmoves >= 100) {
    return 'fifty-move';
  }
  return null;
}

/** True when the position is a draw by a board-state rule (incl. stalemate). */
export function isTerminalDraw(position: Position): boolean {
  const terminal = lineTermination(position);
  return terminal !== null && terminal !== 'checkmate';
}

/**
 * Replay a UCI move list from a starting FEN. Returns an error result (never
 * throws) for an invalid FEN, a malformed UCI token, a non-normal move, or an
 * illegal move. When legal, each ply reports its check/capture character and
 * the walk ends with the resulting `Position`, FEN, material and board-state
 * terminal.
 */
export function walkLine(fen: string, uciMoves: readonly string[]): LineWalkResult {
  const parsed = parsePositionFen(fen);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const position = parsed.position;
  const startTurn = position.turn;
  const plies: LinePly[] = [];
  for (let plyIndex = 0; plyIndex < uciMoves.length; plyIndex += 1) {
    const uci = uciMoves[plyIndex]!;
    const move = parseUci(uci);
    if (!move) {
      return { ok: false, message: `Invalid UCI move: "${uci}".` };
    }
    if (!isNormal(move)) {
      return { ok: false, message: `Unsupported UCI move: "${uci}".` };
    }
    if (!position.isLegal(move)) {
      return { ok: false, message: `Illegal UCI move (ply ${plyIndex}): ${uci}.` };
    }
    const sideToMoveBefore = position.turn;
    const capturedRole = capturedBy(position, move);
    const san = makeSan(position, move);
    position.play(move);
    plies.push({
      plyIndex,
      moveUci: uci,
      san,
      sideToMoveBefore,
      isCheck: position.isCheck(),
      isCapture: capturedRole !== null,
      capturedRole,
      fenAfter: fenOf(position),
    });
  }
  return {
    ok: true,
    walk: {
      startFen: fen,
      startTurn,
      plies,
      final: endOf(position),
    },
  };
}

/**
 * Forcingness of a line: the share of plies that are checks or captures
 * (research §4). A ply that is both a check and a capture counts once (union).
 * Returns `0` for an empty line.
 *
 * Reading note: §4's gloss "forcing if ≥ 0.5, i.e. at least half the plies are
 * checks or captures" (and §2's "≥ 70 % of the moves are checks or captures")
 * defines the metric as the fraction of forcing plies over the line length.
 * This module implements that fraction; the literal `(checks + captures) /
 * (2·L)` algebra in §4 would cap ordinary lines (whose plies are rarely
 * simultaneously checks and captures) near 0.5, which the threshold prose
 * rules out. The double-counting difference is limited to plies that are both,
 * which the union counting here deliberately excludes.
 */
export function forcingness(walk: LineWalk): number {
  const length = walk.plies.length;
  if (length === 0) {
    return 0;
  }
  let forcing = 0;
  for (const ply of walk.plies) {
    if (ply.isCheck || ply.isCapture) {
      forcing += 1;
    }
  }
  return Math.min(1, Math.max(0, forcing / length));
}

/**
 * Net material change for the line's starting mover, in piece-value units
 * (P=1 N=3 B=3 R=5 Q=9), positive when the starting mover is up at the end of
 * the line. Computed from the captured piece of every capture ply during the
 * walk, so it never needs an unknown captured square and is never `null` for a
 * legal walk; an empty or capture-free line yields `0`.
 */
export function materialDelta(walk: LineWalk): number {
  let delta = 0;
  for (const ply of walk.plies) {
    if (ply.capturedRole === null) {
      continue;
    }
    const sign = ply.sideToMoveBefore === walk.startTurn ? 1 : -1;
    delta += sign * pieceValue(ply.capturedRole);
  }
  return delta;
}

function capturedBy(position: Position, move: NormalMove): Role | null {
  const victim = position.board.get(move.to);
  if (victim && victim.color !== position.turn) {
    return victim.role;
  }
  const mover = position.board.get(move.from);
  if (mover && mover.role === 'pawn' && move.to === position.epSquare) {
    return 'pawn';
  }
  return null;
}

function endOf(position: Position): LineEnd {
  return {
    position: position.clone(),
    fen: fenOf(position),
    turn: position.turn,
    material: materialOf(position),
    termination: lineTermination(position),
  };
}

function materialOf(position: Position): MaterialBalance {
  let white = 0;
  let black = 0;
  for (let square = 0; square < 64; square += 1) {
    const piece = position.board.get(square);
    if (!piece) {
      continue;
    }
    if (piece.color === 'white') {
      white += pieceValue(piece.role);
    } else {
      black += pieceValue(piece.role);
    }
  }
  return { white, black };
}
