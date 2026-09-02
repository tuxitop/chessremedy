/**
 * Chess position tree for Feature 002.
 *
 * A single immutable source of truth for a board position together with
 * its move history (including variations). The playground drives the
 * chessboard, the move list, navigation and overlays from this model;
 * later features (live analysis, game review, puzzle training) reuse the
 * same shape.
 *
 * The tree is built either from a bare FEN (no history) or from a PGN
 * string. A PGN may carry `[SetUp "1"]` + `[FEN "..."]` headers, in
 * which case the tree's start position is that FEN.
 *
 * A *path* is the ordered list of plies from the start position to the
 * currently displayed position. All navigation operations just change
 * the path; `play` inserts a new ply at the end of the current path.
 */

import { Chess, type Position } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import {
  parsePgn,
  startingPosition as pgnStartingPosition,
  type ChildNode,
  type PgnNodeData,
} from 'chessops/pgn';
import { parseSan, makeSan } from 'chessops/san';
import { parseSquare } from 'chessops/util';
import type { Move, NormalMove, Role, Square } from 'chessops/types';

export type Color = 'white' | 'black';
export type SquareKey = string;

let nextPlyId = 1;

/** A single move in the tree. Immutable; children are first-child-mainline. */
export interface MovePly {
  readonly id: number;
  readonly san: string;
  /** Side that made the move. */
  readonly color: Color;
  /** Full-move number as shown in the move list (1-based). */
  readonly fullMove: number;
  /** Board key of the origin square (`a1`-`h8`). */
  readonly from: SquareKey;
  /** Board key of the destination square. */
  readonly to: SquareKey;
  /** Promotion role when the move promotes a pawn (else `undefined`). */
  readonly promotion: Role | undefined;
  readonly nags: readonly number[];
  /** Raw PGN comments attached to this move (may contain `%cal`/`%csl`). */
  readonly comments: readonly string[];
  /** Ordered continuations; `children[0]` is the mainline next move. */
  readonly children: readonly MovePly[];
}

export interface MoveTree {
  /** FEN of the position before any recorded move. */
  readonly startFen: string;
  /** Side to move at `startFen`. */
  readonly startColor: Color;
  /** Moves playable from the start position. */
  readonly rootChildren: readonly MovePly[];
  /**
   * Decisive game result if known from PGN headers or from a
   * checkmate at the canonical end of the mainline.
   */
  readonly result?: '1-0' | '0-1' | '1/2-1/2';
  /**
   * Ply ids of the canonical end of the mainline (the position the
   * board "lands on" when the fixture is selected and after Reset).
   */
  readonly landing: readonly number[];
}

export interface BuildResult {
  readonly tree: MoveTree;
  /** Set when the PGN could not be replayed legally from its start. */
  readonly error?: string;
}

export type Path = readonly MovePly[];

function colorOfTurn(position: Position): Color {
  return position.turn === 'white' ? 'white' : 'black';
}

function positionFromFenUnchecked(fen: string): Position {
  const setup = parseFen(fen);
  if (setup.isErr) {
    throw new Error(`Invalid FEN: ${fen}`);
  }
  const result = Chess.fromSetup(setup.value);
  if (result.isErr) {
    throw new Error(`Invalid chess setup from FEN: ${fen}`);
  }
  return result.value;
}

/** Parse a FEN to its side-to-move token. */
export function fenSideToMove(fen: string): Color {
  const token = fen.split(/\s+/)[1];
  return token === 'b' ? 'black' : 'white';
}

function fullMoveAt(depth: number): number {
  return Math.floor(depth / 2) + 1;
}

function makePly(
  depth: number,
  color: Color,
  san: string,
  move: NormalMove,
  nags: readonly number[],
  comments: readonly string[],
  children: readonly MovePly[],
): MovePly {
  const from = squareKey(move.from);
  const to = squareKey(move.to);
  return {
    id: nextPlyId++,
    san,
    color,
    fullMove: fullMoveAt(depth),
    from,
    to,
    promotion: move.promotion,
    nags,
    comments,
    children,
  };
}

export function squareKey(square: Square): SquareKey {
  const file = square & 7;
  const rank = square >> 3;
  return `${'abcdefgh'[file]}${rank + 1}`;
}

/**
 * Build a tree from a FEN-only fixture.
 */
export function treeFromFen(fen: string): MoveTree {
  const position = positionFromFenUnchecked(fen);
  return {
    startFen: fen,
    startColor: colorOfTurn(position),
    rootChildren: [],
    landing: [],
  };
}

/**
 * Build a tree from a PGN string. The start position comes from the
 * PGN's `[FEN]` header when present, otherwise the standard start
 * position. Returns `{ error }` when any SAN is illegal from the start
 * position (inconsistent PGN — callers surface this instead of guessing).
 */
export function buildTreeFromPgn(pgn: string): BuildResult {
  let games;
  try {
    games = parsePgn(pgn);
  } catch (err) {
    return { tree: emptyTree(), error: err instanceof Error ? err.message : String(err) };
  }
  const game = games[0];
  if (!game) {
    return { tree: emptyTree(), error: 'Empty PGN' };
  }

  let startPosition: Position;
  try {
    const res = pgnStartingPosition(game.headers);
    if (res.isErr) {
      return { tree: emptyTree(), error: res.error?.message ?? 'Invalid starting position' };
    }
    startPosition = res.value;
  } catch (err) {
    return { tree: emptyTree(), error: err instanceof Error ? err.message : String(err) };
  }

  const error: string[] = [];
  const rootChildren = buildChildren(game.moves.children, startPosition, 0, error);
  if (error.length > 0) {
    return { tree: emptyTree(), error: error.join('\n') };
  }

  // Canonical end of the mainline (first-child chain).
  const landing: number[] = [];
  let mainlineNode: MovePly | undefined = rootChildren[0];
  while (mainlineNode) {
    landing.push(mainlineNode.id);
    mainlineNode = mainlineNode.children[0];
  }

  const endPosition = replayToEnd(rootChildren, startPosition);
  const headerResult = game.headers.get('Result');
  let result: MoveTree['result'];
  if (headerResult === '1-0' || headerResult === '0-1' || headerResult === '1/2-1/2') {
    result = headerResult;
  } else if (endPosition.isCheckmate()) {
    result = winnerResult(endPosition);
  }

  return {
    tree: {
      startFen: makeFen(startPosition.toSetup()),
      startColor: colorOfTurn(startPosition),
      rootChildren,
      ...(result ? { result } : {}),
      landing,
    },
  };
}

function emptyTree(): MoveTree {
  return treeFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
}

function buildChildren(
  children: readonly ChildNode<PgnNodeData>[],
  position: Position,
  depth: number,
  error: string[],
): MovePly[] {
  const out: MovePly[] = [];
  // Every child is a legal alternative played from the SAME position
  // (variations are siblings of the mainline move at a node).
  for (const child of children) {
    const move = parseSan(position, child.data.san);
    if (!move || !position.isLegal(move)) {
      error.push(`Illegal move at ${depth + 1}: ${child.data.san}`);
      continue;
    }
    const next = position.clone();
    next.play(move);
    const grandChildren = buildChildren(child.children, next, depth + 1, error);
    out.push(
      makePly(
        depth,
        colorOfTurn(position),
        makeSan(position, move),
        move as NormalMove,
        child.data.nags ?? [],
        child.data.comments ?? [],
        grandChildren,
      ),
    );
  }
  return out;
}

function replayToEnd(rootChildren: readonly MovePly[], start: Position): Position {
  let position = start;
  const walk = (node: MovePly): void => {
    position = playMove(position, node);
  };
  let node = rootChildren[0];
  while (node) {
    walk(node);
    node = node.children[0];
  }
  return position;
}

function playMove(position: Position, ply: MovePly): Position {
  const move = moveFor(ply);
  const next = position.clone();
  next.play(move);
  return next;
}

function moveFor(ply: MovePly): Move {
  return {
    from: parseSquare(ply.from) as Square,
    to: parseSquare(ply.to) as Square,
    ...(ply.promotion ? { promotion: ply.promotion } : {}),
  };
}

function winnerResult(position: Position): '1-0' | '0-1' {
  // The side to move is mated, so the other side won.
  return position.turn === 'white' ? '0-1' : '1-0';
}

/** Current board position for a path. */
export function positionAtPath(tree: MoveTree, path: Path): Position {
  let position = positionFromFenUnchecked(tree.startFen);
  for (const ply of path) {
    position = playMove(position, ply);
  }
  return position;
}

/** `[from, to]` board keys of the last ply on the path (last move played). */
export function lastMoveFromPath(path: Path): [SquareKey, SquareKey] | null {
  const last = path[path.length - 1];
  return last ? [last.from, last.to] : null;
}

/** The side to move at the current position. */
export function sideToMoveAt(tree: MoveTree, path: Path): Color {
  const last = path[path.length - 1];
  if (!last) {
    return tree.startColor;
  }
  return last.color === 'white' ? 'black' : 'white';
}

function descendTo(target: readonly number[], from: readonly MovePly[]): MovePly[] | null {
  let depth = 0;
  const out: MovePly[] = [];
  let children: readonly MovePly[] = from;
  while (depth < target.length) {
    const next = children.find((c) => c.id === target[depth]);
    if (!next) {
      return null;
    }
    out.push(next);
    children = next.children;
    depth += 1;
  }
  return out;
}

/** Navigate to the tree's canonical landing path (first child chain end at build). */
export function pathToLanding(tree: MoveTree): readonly MovePly[] {
  const result = descendTo(tree.landing, tree.rootChildren);
  return result ?? [];
}

/** The mainline end from a given path (last move forward along children[0]). */
export function pathToEnd(tree: MoveTree, path: Path): Path {
  const from = path.length === 0 ? tree.rootChildren : path[path.length - 1]!.children;
  let leaf = path;
  let child: MovePly | undefined = from[0];
  while (child) {
    leaf = [...leaf, child];
    child = child.children[0];
  }
  return leaf;
}

export interface PlayResult {
  readonly tree: MoveTree;
  readonly path: Path;
  readonly san?: string;
  readonly error?: string;
}

/**
 * Play a move `from → to` (with optional promotion) at the end of the
 * current path. The move is validated against the chess rules. If the
 * position already has a child with the same SAN the existing child is
 * selected; otherwise a new ply is appended (a variation when the
 * current node already has continuations, a plain continuation otherwise).
 */
export function play(
  tree: MoveTree,
  path: Path,
  from: SquareKey,
  to: SquareKey,
  promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
): PlayResult {
  const position = positionAtPath(tree, path);
  if (position.isEnd()) {
    return { tree, path, error: 'The game is over.' };
  }
  const move: NormalMove = promotion
    ? { from: parseSquare(from) as Square, to: parseSquare(to) as Square, promotion }
    : { from: parseSquare(from) as Square, to: parseSquare(to) as Square };
  if (!position.isLegal(move)) {
    return { tree, path, error: `Illegal move: ${from}-${to}` };
  }
  const san = makeSan(position, move);
  const parent = path.length === 0 ? tree.rootChildren : path[path.length - 1]!.children;
  const existing = parent.find((c) => c.san === san);
  if (existing) {
    return { tree, path: [...path, existing] };
  }

  const ply = makePly(path.length, colorOfTurn(position), san, move, [], [], []);
  const nextTree = insertPly(tree, path, ply);
  return { tree: nextTree, path: [...path, ply], san };
}

function insertPly(tree: MoveTree, path: Path, ply: MovePly): MoveTree {
  if (path.length === 0) {
    return { ...tree, rootChildren: [...tree.rootChildren, ply] };
  }
  // Rebuild the immutable spine from the deepest ancestor to the root,
  // appending the new ply as a child of the last path node.
  const lastId = path[path.length - 1]!.id;
  const replace = (nodes: readonly MovePly[]): readonly MovePly[] =>
    nodes.map((n) =>
      n.id === lastId
        ? { ...n, children: [...n.children, ply] }
        : { ...n, children: replace(n.children) },
    );
  return { ...tree, rootChildren: replace(tree.rootChildren) };
}

/** Step the path backward/forward by one ply (mainline when moving forward). */
export function step(tree: MoveTree, path: Path, delta: -1 | 1): Path {
  if (delta === -1) {
    return path.slice(0, Math.max(0, path.length - 1));
  }
  const current = path.length === 0 ? tree.rootChildren : path[path.length - 1]!.children;
  const next = current[0];
  return next ? [...path, next] : path;
}

export { positionFromFenUnchecked as fenToPosition };
