/**
 * Game phase classification — canonical rule (specs/domain/game-phase.md).
 *
 * Feature 008 assigns a phase to every analyzed move/position while producing
 * `MoveAnalysis`; ADR-023's `fast` fallback, statistics (Feature 014) and the
 * dashboard (Feature 015) consume the persisted phase. No feature defines its
 * own phase algorithm.
 *
 * V1 rule, deterministic and evaluated from the position's full-move number
 * and the material on the board.
 */

import type { Position } from 'chessops/chess';
import type { Role } from 'chessops/types';
import type { GamePhase } from './analysis';

export const GAME_PHASE_VERSION = 1;

/** Opening boundary: the first 12 full moves. */
export const OPENING_FULL_MOVES = 12;

/** A side needs this many minors or a queen to still be in the middlegame. */
export const MIDDLEGAME_MINOR_PIECES = 4;

const MINOR_ROLES: readonly Role[] = ['bishop', 'knight'];

function countPieces(position: Position, color: 'white' | 'black', roles: readonly Role[]): number {
  let count = 0;
  for (const role of roles) {
    count += position.board.pieces(color, role).size();
  }
  return count;
}

/**
 * Game phase of a position (specs/domain/game-phase.md §Rule (V1)):
 *
 * - `opening` while `moveNumber ≤ 12` (the position's full-move count);
 * - then `middlegame` while either side holds ≥ 4 minor pieces or ≥ 1 queen;
 * - otherwise `endgame` (both sides ≤ 3 minor pieces, no queen).
 */
export function gamePhaseOf(position: Position): GamePhase {
  if (position.fullmoves <= OPENING_FULL_MOVES) {
    return 'opening';
  }
  const whiteMinors = countPieces(position, 'white', MINOR_ROLES);
  const blackMinors = countPieces(position, 'black', MINOR_ROLES);
  const whiteQueens = countPieces(position, 'white', ['queen']);
  const blackQueens = countPieces(position, 'black', ['queen']);
  if (
    whiteMinors >= MIDDLEGAME_MINOR_PIECES ||
    blackMinors >= MIDDLEGAME_MINOR_PIECES ||
    whiteQueens >= 1 ||
    blackQueens >= 1
  ) {
    return 'middlegame';
  }
  return 'endgame';
}
