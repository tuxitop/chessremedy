/**
 * Position helpers (Feature 003).
 *
 * The domain `Position` is the chessops `Position` type (ADR-028) re-exported
 * here. All helpers are deterministic and surface errors instead of throwing.
 */

import { Chess, type Position } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { startingPosition as pgnStartingPosition } from 'chessops/pgn';

export type { Position } from 'chessops/chess';

export type FenResult = { ok: true; position: Position } | { ok: false; message: string };

/** Parse a FEN into a chessops `Position`. */
export function parsePositionFen(fen: string): FenResult {
  const setup = parseFen(fen);
  if (setup.isErr) {
    return { ok: false, message: `Invalid FEN: ${fen}` };
  }
  const result = Chess.fromSetup(setup.value);
  if (result.isErr) {
    return { ok: false, message: `Invalid chess setup from FEN: ${fen}` };
  }
  return { ok: true, position: result.value };
}

/** Canonical FEN for a position. */
export function fenOf(position: Position): string {
  return makeFen(position.toSetup());
}

/**
 * Resolve the start position of a PGN from its headers. Honours
 * `[SetUp "1"]` + `[FEN "..."]` (via chessops/pgn `startingPosition`),
 * otherwise returns the standard chess start position.
 */
export function resolveStartPosition(headers: ReadonlyMap<string, string>): FenResult {
  const result = pgnStartingPosition(new Map(headers));
  if (result.isErr) {
    return { ok: false, message: result.error?.message ?? 'Invalid starting position' };
  }
  return { ok: true, position: result.value };
}
