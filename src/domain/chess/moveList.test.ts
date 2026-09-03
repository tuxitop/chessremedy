import { describe, expect, it } from 'vitest';
import { parsePgn, makePgn } from 'chessops/pgn';
import type { ChildNode, PgnNodeData } from 'chessops/pgn';
import { fenOf, resolveStartPosition } from './position';
import { createMoveList, mainlineNodes, nodeAtPath, validateReplay } from './moveList';
import type { MoveList } from './moveList';

function listOf(pgn: string): MoveList {
  const game = parsePgn(pgn)[0];
  if (!game) {
    throw new Error('No game parsed');
  }
  const start = resolveStartPosition(game.headers);
  if (!start.ok) {
    throw new Error(start.message);
  }
  return createMoveList(game.moves, fenOf(start.position));
}

function childNode(list: MoveList, path: readonly number[]): ChildNode<PgnNodeData> {
  const node = nodeAtPath(list, path);
  if (!node || !('data' in node)) {
    throw new Error(`Expected a child node at path [${path.join(',')}]`);
  }
  return node as ChildNode<PgnNodeData>;
}

describe('moveList mainline & variations', () => {
  it('walks the first-child mainline', () => {
    const list = listOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4');
    expect(mainlineNodes(list).map((n) => n.data.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bb5',
      'a6',
      'Ba4',
    ]);
  });

  it('keeps variations as siblings under the correct parent node', () => {
    const list = listOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4');
    const nc6 = childNode(list, [0, 0, 0, 0]);
    expect(nc6.data.san).toBe('Nc6');
    expect(nc6.children.map((c) => c.data.san)).toEqual(['Bb5', 'Bc4']);
  });

  it('resolves empty, nested and invalid paths', () => {
    const list = listOf('1. e4 e5 2. Nf3 Nc6 (2...d6)');
    expect(nodeAtPath(list, [])).toBe(list.root);
    expect(childNode(list, [0, 0]).data.san).toBe('e5');
    expect(nodeAtPath(list, [1])).toBeNull();
    expect(childNode(list, [0, 0, 0]).data.san).toBe('Nf3');
    expect(childNode(list, [0, 0, 0, 0]).data.san).toBe('Nc6');
    expect(childNode(list, [0, 0, 0, 1]).data.san).toBe('d6');
    expect(nodeAtPath(list, [0, 0, 0, 1, 0])).toBeNull();
  });
});

describe('moveList comment / NAG round-trip', () => {
  it('preserves nags and comments semantically through makePgn and re-parse', () => {
    const raw = "1. e4! {The King's Pawn opening} e5?? 2. Nf3 {quiet} Nc6";
    const game = parsePgn(raw)[0]!;
    const rewritten = makePgn(game);
    const reparsed = parsePgn(rewritten)[0]!;

    const capture = (g: (typeof game)['moves']) =>
      [...g.mainlineNodes()].map((n) => ({
        san: n.data.san,
        nags: n.data.nags ?? [],
        comments: (n.data.comments ?? []).map((c) => c.trim()),
      }));

    expect(capture(reparsed.moves)).toEqual(capture(game.moves));
  });

  it('keeps a variation-starting comment on the variation node', () => {
    const list = listOf('1. e4 {Open} c5 (1... {Classical} e5 2. Nf3) 2. Nf3 d6');
    const variationStart = childNode(list, [0, 1]);
    expect(variationStart.data.san).toBe('e5');
    expect(variationStart.data.startingComments).toEqual(['Classical']);
    expect(mainlineNodes(list).map((n) => n.data.san)).toEqual(['e4', 'c5', 'Nf3', 'd6']);
  });
});

describe('validateReplay', () => {
  it('accepts a legal tree', () => {
    expect(validateReplay(listOf('1. e4 e5 2. Nf3 Nc6 (2...d6)'))).toEqual([]);
  });

  it('rejects an illegal SAN in the mainline', () => {
    const errors = validateReplay(listOf('1. Qe5+ Kd8'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Qe5+');
  });

  it('rejects an illegal SAN inside a variation', () => {
    const errors = validateReplay(listOf('1. e4 (1...Ra5) e5'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Ra5');
  });
});
