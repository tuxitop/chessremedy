/**
 * Game → analysis plan extraction (Feature 008 §2).
 *
 * Reconstructs a game from its initial position (via the Feature-003 replay
 * helpers) and derives, for every mainline ply, the data Feature 008 needs:
 * position before the move, the move played, the mover, the full-move number,
 * legal-move count and game phase, plus the ordered list of FENs to submit to
 * the engine (position before each move and the non-terminal position after
 * the last move).
 *
 * Pure, deterministic, framework-agnostic.
 */

import type { Color } from 'chessops/types';
import type { GamePhase, PlayedMove } from '@/domain/chess';
import type { Game } from '@/domain/chess/game';
import { mainlineMoves } from '@/domain/chess/move';
import { gamePhaseOf } from '@/domain/chess/gamePhase';
import { parsePositionFen, type Position } from '@/domain/chess/position';

/** One mainline move to analyze. */
export interface PlannedMove {
  /** 0-based index of the position before the move. */
  readonly ply: number;
  /** Full move number (1-based). */
  readonly moveNumber: number;
  readonly side: Color;
  readonly playedMove: PlayedMove;
  /** Canonical FEN of the position before the move. */
  readonly positionFen: string;
  /** Canonical FEN of the position after the move. */
  readonly fenAfter: string;
  readonly legalMovesCount: number;
  readonly gamePhase: GamePhase;
  /** True when `fenAfter` is a terminal position (never submitted). */
  readonly terminalAfter: boolean;
}

export interface GameAnalysisPlan {
  readonly gameId: string;
  readonly moves: readonly PlannedMove[];
  /** Ordered (deduplicated) non-terminal FENs to submit to the engine. */
  readonly analyzeFens: readonly string[];
}

export type PlanErrorCode = 'no-moves' | 'unplayable';

export type PlanResult =
  | { readonly ok: true; readonly plan: GameAnalysisPlan }
  | { readonly ok: false; readonly code: PlanErrorCode; readonly message: string };

/** Number of legal moves in a position (for forced-move classification). */
export function countLegalMoves(position: Position): number {
  let count = 0;
  for (const dests of position.allDests().values()) {
    count += dests.size();
  }
  return count;
}

/**
 * Build the analysis plan for a stored game. Games with no recorded moves
 * cannot be analyzed (a forfeit-only PGN has no ply to classify).
 */
export function planGameAnalysis(game: Game): PlanResult {
  const moves = mainlineMoves(game.moves);
  if (moves.length === 0) {
    return {
      ok: false,
      code: 'no-moves',
      message: 'The game has no moves to analyze.',
    };
  }

  const planned: PlannedMove[] = [];
  const analyzeFens: string[] = [];
  const seen = new Set<string>();
  const pushFen = (fen: string): void => {
    if (!seen.has(fen)) {
      seen.add(fen);
      analyzeFens.push(fen);
    }
  };

  for (const move of moves) {
    const before = parsePositionFen(move.fenBefore);
    const after = parsePositionFen(move.fenAfter);
    if (!before.ok) {
      return { ok: false, code: 'unplayable', message: before.message };
    }
    if (!after.ok) {
      return { ok: false, code: 'unplayable', message: after.message };
    }
    pushFen(move.fenBefore);
    const terminalAfter = after.position.isEnd();
    if (!terminalAfter) {
      pushFen(move.fenAfter);
    }
    planned.push({
      ply: move.ply,
      moveNumber: move.fullMove,
      side: move.color,
      playedMove: { san: move.san, uci: move.uci },
      positionFen: move.fenBefore,
      fenAfter: move.fenAfter,
      legalMovesCount: countLegalMoves(before.position),
      gamePhase: gamePhaseOf(before.position),
      terminalAfter,
    });
  }

  return { ok: true, plan: { gameId: game.id, moves: planned, analyzeFens } };
}
