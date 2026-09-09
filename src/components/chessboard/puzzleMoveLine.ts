/**
 * Solve move-line materialization for puzzle training (Feature 012, plan 012b).
 *
 * A puzzle is presented inside its own game context: the move list is the
 * stored game prefix (the `MoveAnalysis` records before the puzzle's
 * `sourcePly`) with the played/solution moves appended on the mainline and
 * wrong attempts appended as variation siblings under the decision node —
 * exactly like Review's explore moves. Chess rules/state stay on the shared
 * `positionTree` model so the move list, transport, board and engine wiring
 * all read one tree.
 *
 * This module is pure (no React, no database); every helper rebuilds an
 * immutable `MoveTree` from a FEN + UCI tokens, so the tree is always
 * consistent with the domain's token trace.
 */

import { isNormal } from 'chessops/types';
import { parseUci } from 'chessops/util';
import type { MoveAnalysis } from '@/domain/chess';
import type { PuzzleRow } from '@/domain/puzzle';
import { play, treeFromFen, type MovePly, type MoveTree, type Path } from './positionTree';

/** A move as the squares/promotion the `positionTree.play` helper expects. */
export interface UciSquares {
  readonly from: string;
  readonly to: string;
  readonly promotion?: 'queen' | 'rook' | 'bishop' | 'knight';
}

/** Split a canonical UCI token into squares (+ optional promotion role). */
export function uciSquares(uci: string): UciSquares | null {
  const parsed = parseUci(uci);
  if (!parsed || !isNormal(parsed)) {
    return null;
  }
  const promotion = parsed.promotion;
  return {
    from: squareOf(parsed.from),
    to: squareOf(parsed.to),
    ...(promotion !== undefined && promotion !== 'pawn' && promotion !== 'king'
      ? { promotion }
      : {}),
  };
}

function squareOf(square: number): string {
  const file = square & 7;
  const rank = square >> 3;
  return `${'abcdefgh'[file]}${rank + 1}`;
}

/** Play one UCI token at the end of `path` (existing SAN re-selects). */
export function playUci(tree: MoveTree, path: Path, uci: string): { tree: MoveTree; path: Path } {
  const parts = uciSquares(uci);
  if (parts === null) {
    return { tree, path };
  }
  const result = play(tree, path, parts.from, parts.to, parts.promotion);
  return result.error ? { tree, path } : { tree: result.tree, path: result.path };
}

/**
 * Result of materializing a puzzle's move line. `error` is set when the line
 * cannot replay from the start FEN (a caller/data defect; callers fall back to
 * a puzzle-only line rather than crash).
 */
export interface SolveLineResult {
  readonly tree: MoveTree;
  readonly error?: string;
}

/** One wrong attempt: `depth` = mainline ply depth of the decision node. */
export interface SolveVariation {
  readonly depth: number;
  readonly uci: string;
}

export interface SolveLineSpec {
  /** FEN the mainline starts from (the game start, or the puzzle start). */
  readonly startFen: string;
  /** Mainline UCI tokens in play order (game prefix + played/solution). */
  readonly mainline: readonly string[];
  /** Wrong attempts to append as variation siblings under decision nodes. */
  readonly variations?: readonly SolveVariation[];
}

/** The mainline (first-child chain) of a tree as a path. */
export function mainlinePathOf(tree: MoveTree, depth: number): Path {
  const out: MovePly[] = [];
  let node: MovePly | undefined = tree.rootChildren[0];
  while (node && out.length < depth) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

/**
 * Build the full solve tree: start from `startFen`, play every mainline token
 * down the first-child chain, then attach each wrong attempt as a variation
 * child under its decision node (path = the first `depth` mainline plies).
 * Returns `{ error }` when a token is illegal or the start FEN does not parse.
 */
export function buildSolveLine(spec: SolveLineSpec): SolveLineResult {
  let tree: MoveTree;
  try {
    tree = treeFromFen(spec.startFen);
  } catch {
    return { tree: treeFromFen(STANDARD_START_FEN), error: `Invalid start FEN: ${spec.startFen}` };
  }
  let path: Path = [];
  for (const uci of spec.mainline) {
    const parts = uciSquares(uci);
    if (parts === null) {
      return { tree, error: `Invalid mainline token "${uci}".` };
    }
    const result = play(tree, path, parts.from, parts.to, parts.promotion);
    if (result.error) {
      return { tree, error: `Mainline token "${uci}" does not replay: ${result.error}` };
    }
    tree = result.tree;
    path = result.path;
  }
  for (const variation of spec.variations ?? []) {
    const parts = uciSquares(variation.uci);
    if (parts === null) {
      continue;
    }
    const nodePath = mainlinePathOf(tree, variation.depth);
    if (nodePath.length !== variation.depth) {
      continue;
    }
    const result = play(tree, nodePath, parts.from, parts.to, parts.promotion);
    if (!result.error) {
      tree = result.tree;
    }
  }
  return { tree };
}

const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The game prefix of a puzzle row from its stored analysis records. */
export interface PuzzlePrefix {
  /** FEN the prefix starts from (the game's first position). */
  readonly startFen: string;
  /** Prefix UCI tokens in play order. */
  readonly tokens: readonly string[];
}

/**
 * The prefix to render before the puzzle: `records.slice(0, row.sourcePly)`
 * replayed from the first record's position. Returns `null` when there are no
 * usable prefix records (no stored analysis, or a prefix that does not replay)
 * — callers then present the puzzle from `startingFen` alone.
 */
export function puzzlePrefixOf(
  row: PuzzleRow,
  records: readonly MoveAnalysis[],
): PuzzlePrefix | null {
  const count = Math.max(0, Math.min(row.sourcePly, records.length));
  if (count === 0) {
    return null;
  }
  const first = records[0];
  const tokens = records
    .slice(0, count)
    .map((record) => record.playedMove.uci)
    .filter((uci) => uci.length >= 4);
  if (tokens.length !== count || first === undefined) {
    return null;
  }
  const built = buildSolveLine({ startFen: first.positionFen, mainline: tokens });
  return built.error ? null : { startFen: built.tree.startFen, tokens };
}
