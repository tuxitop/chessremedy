/**
 * Game end detection (Feature 007 library rows + Feature 008 review).
 *
 * Deterministic, domain-only helpers that answer "how did this game end and
 * how long was it?" from the chessops move tree — no engine, no React.
 *
 * Board-state endings (checkmate, stalemate, insufficient material, the
 * fifty-move rule and threefold repetition) are detected from the replayed
 * mainline. A decisive game that ended without a board state (flag /
 * resignation / abandonment) is indistinguishable from the tree alone, so
 * `termination` stays `null` for those and the UI falls back to the result.
 */

import { parseSan } from 'chessops/san';
import { fenOf, parsePositionFen } from './position';
import type { GameResult } from './game';
import { mainlineNodes, type MoveList } from './moveList';

export const GAME_TERMINATIONS = [
  'checkmate',
  'stalemate',
  'insufficient-material',
  'fifty-move',
  'threefold',
  'agreement',
] as const;

export type GameTermination = (typeof GAME_TERMINATIONS)[number];

export interface GameEndInfo {
  /** Full-move count of the game's mainline (e.g. 32 for a 64-ply game). */
  readonly moveCount: number;
  /** How the game ended when the board or result makes it knowable. */
  readonly termination: GameTermination | null;
}

/** Position identity key for repetition: material, side to move, castling, en
 * passant (half-move/full-move counters are ignored). */
function repetitionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * Compute the end info from the game's mainline. A parse/legal-replay failure
 * never throws — it yields the partial move count and a null termination.
 */
export function gameEndOf(list: MoveList, result: GameResult): GameEndInfo {
  const start = parsePositionFen(list.startFen);
  if (!start.ok) {
    return { moveCount: 0, termination: null };
  }

  const nodes = mainlineNodes(list);
  let position = start.position.clone();
  const seen = new Map<string, number>();
  let threefold = false;

  for (const node of nodes) {
    let move;
    try {
      move = parseSan(position, node.data.san);
    } catch {
      return { moveCount: Math.ceil(nodes.indexOf(node) / 2), termination: null };
    }
    if (!move || !position.isLegal(move)) {
      return { moveCount: Math.ceil(nodes.indexOf(node) / 2), termination: null };
    }
    const next = position.clone();
    next.play(move);
    position = next;

    const key = repetitionKey(fenOf(position));
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count >= 3) {
      threefold = true;
    }
  }

  const moveCount = Math.ceil(nodes.length / 2);
  if (position.isCheckmate()) {
    return { moveCount, termination: 'checkmate' };
  }
  if (position.isStalemate()) {
    return { moveCount, termination: 'stalemate' };
  }
  if (position.isInsufficientMaterial()) {
    return { moveCount, termination: 'insufficient-material' };
  }
  if (position.halfmoves >= 100) {
    return { moveCount, termination: 'fifty-move' };
  }
  if (threefold) {
    return { moveCount, termination: 'threefold' };
  }
  if (result === '1/2-1/2') {
    return { moveCount, termination: 'agreement' };
  }
  return { moveCount, termination: null };
}

const TERMINATION_LABELS: Readonly<Record<GameTermination, string>> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  'insufficient-material': 'Insufficient material',
  'fifty-move': '50-move rule',
  threefold: 'Repetition',
  agreement: 'Draw agreed',
};

export function terminationLabel(termination: GameTermination | null): string | null {
  return termination === null ? null : TERMINATION_LABELS[termination];
}
