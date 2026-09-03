/**
 * MoveList — the tree-structured PGN representation (Feature 003, ADR-028).
 *
 * A `MoveList` wraps a chessops `Node<PgnNodeData>` tree (no translation
 * layer). NAGs and comments live on the nodes as `number[]` / `string[]`.
 * `NodePath` (a child-index chain) is the stable addressing scheme the move
 * list UI and analysis pipeline use to seek/annotate later features.
 *
 * Comment-representability note: a PGN's game-level intro comment (before the
 * first move) is stored by chessops on the parsed `Game`, not on any node, so
 * it is not carried by `MoveList`; it is preserved only via `Game.pgn`.
 */

import type { Position } from 'chessops/chess';
import type { ChildNode, Node, PgnNodeData } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { parsePositionFen } from './position';

export type PgnNode = ChildNode<PgnNodeData>;

/** Child-index chain from the tree root; `[]` addresses the start position. */
export type NodePath = readonly number[];

export interface MoveList {
  /** Canonical FEN of the position before any recorded move. */
  readonly startFen: string;
  /** The chessops PgnNode tree itself (no copy). */
  readonly root: Node<PgnNodeData>;
}

export function createMoveList(root: Node<PgnNodeData>, startFen: string): MoveList {
  return { startFen, root };
}

/** The mainline (first-child chain) as a list of child nodes. */
export function mainlineNodes(list: MoveList): readonly PgnNode[] {
  return [...list.root.mainlineNodes()];
}

/** Node at a path; the start position (`[]`) returns the root. */
export function nodeAtPath(list: MoveList, path: NodePath): Node<PgnNodeData> | null {
  let node: Node<PgnNodeData> = list.root;
  for (const index of path) {
    const child = node.children[index];
    if (!child) {
      return null;
    }
    node = child;
  }
  return node;
}

/**
 * Validate that every SAN in the tree (all variations) replays legally from
 * the start position. Returns a list of messages; empty means valid. An
 * inconsistent tree is never silently "fixed".
 */
export function validateReplay(list: MoveList): readonly string[] {
  const start = parsePositionFen(list.startFen);
  if (!start.ok) {
    return [start.message];
  }
  const errors: string[] = [];
  collectReplayErrors(list.root, start.position, 0, errors);
  return errors;
}

function collectReplayErrors(
  node: Node<PgnNodeData>,
  position: Position,
  ply: number,
  errors: string[],
): void {
  for (const child of node.children) {
    const move = parseSanSafe(position, child.data.san);
    if (!move || !position.isLegal(move)) {
      errors.push(`Illegal move (ply ${ply}): ${child.data.san}`);
      continue;
    }
    const next = position.clone();
    next.play(move);
    collectReplayErrors(child, next, ply + 1, errors);
  }
}

function parseSanSafe(position: Position, san: string): ReturnType<typeof parseSan> | undefined {
  try {
    return parseSan(position, san);
  } catch {
    return undefined;
  }
}
