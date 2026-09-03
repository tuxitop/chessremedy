/**
 * Shared engine display formatting (Feature 006).
 *
 * Pure, deterministic helpers used by the analysis panel/header and the
 * playground. Extracted from the original Feature 005 EnginePanel so both the
 * live-analysis chrome and the playground render identical text.
 */

import { uciPvToSan } from '@/domain/chess';
import type { EngineEvaluation, EngineLine } from '@/infrastructure/engine/types';
import { evaluationFromBottom, type PlayerColor } from './evaluation';

/** `+0.72`, `-1.34`, `M3`, `-M5` — mate is never rendered as centipawns. */
export function formatEvaluation(evaluation: EngineEvaluation): string {
  if ('mate' in evaluation) {
    return evaluation.mate > 0 ? `M${evaluation.mate}` : `-M${Math.abs(evaluation.mate)}`;
  }
  const cp = evaluation.cp;
  const sign = cp > 0 ? '+' : cp < 0 ? '-' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

/** Side to move implied by a FEN. */
export function sideToMoveOf(fen: string): PlayerColor {
  const token = fen.split(/\s+/)[1];
  return token === 'b' ? 'black' : 'white';
}

/** Format an evaluation (side-to-move perspective) from White's viewpoint. */
export function formatWhiteEvaluation(evaluation: EngineEvaluation, fen: string): string {
  const asWhite = evaluationFromBottom(evaluation, 'white', sideToMoveOf(fen));
  return formatEvaluation(asWhite);
}

/** `1234` → `1.2k`, `1400000` → `1.4M`. */
export function formatNodes(nodes: number): string {
  if (nodes >= 1_000_000) {
    return `${(nodes / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (nodes >= 1_000) {
    return `${(nodes / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(nodes);
}

/** `2100` → `2.1s`. */
export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fenMoveContext(fen: string): { fullmove: number; whiteToMove: boolean } {
  const parts = fen.split(/\s+/);
  const fullmove = Number.parseInt(parts[5] ?? '', 10);
  return {
    fullmove: Number.isFinite(fullmove) ? fullmove : 1,
    whiteToMove: parts[1] !== 'b',
  };
}

/** Number a SAN move list with PGN-style move numbers from the FEN. */
export function numberSans(fen: string, sans: readonly string[]): string {
  const { fullmove, whiteToMove } = fenMoveContext(fen);
  const out: string[] = [];
  for (let i = 0; i < sans.length; i += 1) {
    const san = sans[i]!;
    const isWhiteMove = whiteToMove ? i % 2 === 0 : i % 2 === 1;
    const pair = Math.floor(i / 2);
    if (isWhiteMove) {
      const moveNumber = fullmove + (whiteToMove ? pair : pair + 1);
      out.push(`${moveNumber}.`);
    } else if (i === 0) {
      // The line starts with a Black move: `3... exd4`.
      out.push(`${fullmove}...`);
    }
    out.push(san);
  }
  return out.join(' ');
}

/**
 * Render an engine PV as numbered SAN when possible, falling back to raw UCI
 * tokens (e.g. `3. d4 exd4 4. Nxd5 …`).
 */
export function formatPv(fen: string, uciMoves: readonly { readonly uci: string }[]): string {
  if (uciMoves.length === 0) return '';
  const tokens = uciMoves.map((m) => m.uci);
  const converted = uciPvToSan(fen, tokens);
  if (!converted.ok) return tokens.join(' ');
  return numberSans(fen, converted.sans);
}

/** The first move of a PV as `[from, to]` chessground keys, or null. */
export function firstMoveSquares(line: EngineLine): { from: string; to: string } | null {
  const first = line.principalVariation[0];
  if (!first) return null;
  const uci = first.uci;
  if (uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}
