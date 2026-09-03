/**
 * Game aggregate model (Feature 003).
 *
 * A `Game` represents one imported chess game. Its move tree is a chessops
 * `Node<PgnNodeData>` wrapper (`MoveList`) — see ADR-028. The model keeps
 * provider identifiers/source information without leaking provider formats.
 */

import type { Color } from 'chessops/types';
import type { GameSource } from './gameSource';
import type { MoveList } from './moveList';
import type { TimeControlCategory } from './timeControl';

export type GameId = string;

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export type GameOutcome = 'whiteWins' | 'blackWins' | 'draw' | 'unknown';

export interface Player {
  readonly name: string;
  /** Provider Elo at game time; `null` when unknown. */
  readonly rating: number | null;
}

export interface Game {
  readonly id: GameId;
  /** Platform/origin dimension (ADR-013 statistics grouping). */
  readonly source: GameSource;
  /** Provider game id; `null` for local/fixture games (D7). */
  readonly externalId: string | null;
  /** ISO-8601 UTC or `null` when the date is unknown (D8). */
  readonly playedAt: string | null;
  readonly whitePlayer: Player;
  readonly blackPlayer: Player;
  /** PGN result token (`*` when undetermined). */
  readonly result: GameResult;
  /** Raw provider time-control string, verbatim (ADR-013). */
  readonly timeControl: string;
  /** Normalized time-control category (ADR-013). */
  readonly normalizedTimeControl: TimeControlCategory;
  /** Side of the importing user. */
  readonly userColor: Color;
  /** Original raw PGN text. */
  readonly pgn: string;
  /** chessops `PgnNode` tree wrapper (ADR-028). */
  readonly moves: MoveList;
}

export function outcomeOf(result: GameResult): GameOutcome {
  switch (result) {
    case '1-0':
      return 'whiteWins';
    case '0-1':
      return 'blackWins';
    case '1/2-1/2':
      return 'draw';
    default:
      return 'unknown';
  }
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1aHex(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable identity across repeated imports of the same game.
 *
 * Provider games are identified by their provider id; local/fixture games
 * use an FNV-1a hash over the PGN text prefixed by the source (D7).
 * Feature 004/007 own the definitive dedupe policy.
 */
export function makeGameId(source: GameSource, externalId: string | null, pgn: string): GameId {
  if (externalId !== null && externalId !== '') {
    return `${source}:${externalId}`;
  }
  return `${source}:${fnv1aHex(pgn)}`;
}
