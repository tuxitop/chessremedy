import { describe, expect, it } from 'vitest';
import {
  buildTreeFromPgn,
  play,
  positionAtPath,
  step,
  pathToEnd,
  pathToLanding,
  treeFromFen,
  type MoveTree,
} from './positionTree';
import { makeFen } from 'chessops/fen';

function treeOf(pgn: string): MoveTree {
  const built = buildTreeFromPgn(pgn);
  if (built.error) {
    throw new Error(built.error);
  }
  return built.tree;
}

describe('positionTree', () => {
  it('builds a tree from a FEN-only fixture', () => {
    const tree = treeFromFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    expect(tree.rootChildren).toHaveLength(0);
    expect(tree.startColor).toBe('white');
    expect(positionAtPath(tree, []).turn).toBe('white');
  });

  it('parses a PGN mainline and reports the landing ply count', () => {
    const tree = treeOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4');
    const landing = pathToLanding(tree);
    expect(landing.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']);
  });

  it('keeps variations as siblings of the mainline move', () => {
    const tree = treeOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4');
    const nc6 = tree.rootChildren[0]!.children[0]!.children[0]!.children[0]!;
    // After 2... Nc6 the alternatives are 3. Bb5 (main) and 3. Bc4.
    expect(nc6.children.map((c) => c.san)).toEqual(['Bb5', 'Bc4']);
  });

  it('rejects PGNs whose SANs are illegal from the start', () => {
    const built = buildTreeFromPgn('1. Qe5+ Kd8'); // no queen at start
    expect(built.error).toBeTruthy();
  });

  it('plays a legal move and advances the path', () => {
    const tree = treeOf('1. e4 e5');
    const result = play(tree, [], 'e2', 'e4');
    expect(result.error).toBeUndefined();
    expect(result.path.map((p) => p.san)).toEqual(['e4']);
    expect(makeFen(positionAtPath(result.tree, result.path).toSetup())).toContain('PPPP1PPP');
  });

  it('rejects an illegal move', () => {
    const tree = treeOf('1. e4 e5');
    const result = play(tree, [], 'e2', 'e5');
    expect(result.error).toBeTruthy();
  });

  it('steps backward and forward along the mainline', () => {
    const tree = treeOf('1. e4 e5 2. Nf3');
    const landing = pathToLanding(tree);
    const back = step(tree, landing, -1);
    expect(back.map((p) => p.san)).toEqual(['e4', 'e5']);
    const forward = step(tree, back, 1);
    expect(forward.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('goes to the end of the current line', () => {
    const tree = treeOf('1. e4 e5 2. Nf3 Nc6');
    const end = pathToEnd(tree, []);
    expect(end).toHaveLength(4);
  });

  it('promotes a pawn when a role is supplied', () => {
    const tree = treeFromFen('8/P7/8/8/8/8/8/4K2k w - - 0 1');
    const result = play(tree, [], 'a7', 'a8', 'queen');
    expect(result.error).toBeUndefined();
    expect(result.san).toBe('a8=Q+');
    const position = positionAtPath(result.tree, result.path);
    let whiteQueen = false;
    for (const [, piece] of position.board) {
      if (piece.role === 'queen' && piece.color === 'white') {
        whiteQueen = true;
      }
    }
    expect(whiteQueen).toBe(true);
    expect(position.isCheck()).toBe(true);
  });
});
