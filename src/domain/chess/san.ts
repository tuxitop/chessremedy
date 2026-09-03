/**
 * UCI → SAN principal-variation rendering (Feature 005, decision D7).
 *
 * The engine returns PVs as UCI move tokens (`g1f3 d7d5`). Converting them
 * to readable SAN is a pure chess-domain transform over chessops (ADR-028),
 * so it lives here — not in the engine layer — and stays deterministic.
 */

import { makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { parsePositionFen } from './position';

export type UciPvToSanResult =
  { ok: true; sans: readonly string[] } | { ok: false; message: string };

/**
 * Render a UCI move list as SAN from the given FEN, applying each move in
 * sequence. Returns an error result (never throws) for an invalid FEN, a
 * malformed UCI token, or an illegal move.
 */
export function uciPvToSan(fen: string, uciMoves: readonly string[]): UciPvToSanResult {
  const parsed = parsePositionFen(fen);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const position = parsed.position;
  const sans: string[] = [];
  for (const uci of uciMoves) {
    const move = parseUci(uci);
    if (!move) {
      return { ok: false, message: `Invalid UCI move: "${uci}".` };
    }
    if (!position.isLegal(move)) {
      return { ok: false, message: `Illegal UCI move from "${fen}": ${uci}.` };
    }
    sans.push(makeSan(position, move));
    position.play(move);
  }
  return { ok: true, sans };
}
