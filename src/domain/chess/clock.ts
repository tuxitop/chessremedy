/**
 * PGN clock annotations — canonical parser (Feature 003/008, domain/clock.md).
 *
 * `[%clk H:MM:SS[.fff]]` in a move's comment records the **remaining time of
 * the side that just moved, after that move**. chessops already exposes the
 * per-node comment strings; its `parseComment` strips `%clk`/`%emt`/`%eval`/
 * `%cal`/`%csl` structurally and returns `clock` (seconds). This module maps
 * that onto the mainline with the mover's color and the domain ply index.
 *
 * `%emt` is elapsed move time and is deliberately ignored (kept separate,
 * never folded into clock data). Missing/malformed annotations yield `null`.
 */

import { parseComment } from 'chessops/pgn';
import type { Color } from 'chessops/types';
import type { MoveList, PgnNode } from './moveList';
import { mainlineNodes } from './moveList';
import type { Move } from './move';
import { mainlineMoves } from './move';

/** Remaining clock of a move's player after the move. */
export interface MoveClock {
  /** Domain ply index (aligned with `MoveAnalysis.ply`). */
  readonly ply: number;
  readonly color: Color;
  /** Remaining time after the move, in milliseconds. */
  readonly clockMs: number;
}

/** The mainline clock state of a game (`MoveClock` per moved ply). */
export type GameClocks = readonly MoveClock[];

/** Extract the first valid `%clk` (seconds) from a list of raw comments. */
export function extractClockSeconds(comments: readonly string[]): number | null {
  for (const comment of comments) {
    const parsed = parseComment(comment);
    if (parsed.clock !== undefined && parsed.clock !== null && parsed.clock >= 0) {
      return parsed.clock;
    }
  }
  return null;
}

function nodeComments(node: PgnNode): readonly string[] {
  return [...(node.data.startingComments ?? []), ...(node.data.comments ?? [])];
}

/**
 * Mainline clocks for a game, aligned to the domain `Move` list (which is
 * replayed legally from the start position). A move without a `%clk`
 * annotation is simply omitted — no clock is fabricated.
 */
export function gameClocks(
  moves: MoveList,
  mainline: readonly Move[] = mainlineMoves(moves),
): GameClocks {
  const nodes = mainlineNodes(moves);
  const out: MoveClock[] = [];
  for (let index = 0; index < mainline.length && index < nodes.length; index += 1) {
    const move = mainline[index]!;
    const seconds = extractClockSeconds(nodeComments(nodes[index]!));
    if (seconds !== null) {
      out.push({ ply: move.ply, color: move.color, clockMs: Math.round(seconds * 1000) });
    }
  }
  return out;
}
