import { describe, expect, it } from 'vitest';
import { fenOf } from '@/domain/chess';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import { buildTreeFromPgn } from '@/components/chessboard/positionTree';
import { buildMoveListModel } from '@/components/chessboard/MoveList';
import {
  liveClassificationForMove,
  liveClassificationForTree,
  uciOfPly,
} from './liveClassification';
import { positionAtPath, type MoveTree } from '@/components/chessboard/positionTree';

function treeOf(pgn: string): MoveTree {
  const built = buildTreeFromPgn(pgn);
  if (built.error) {
    throw new Error(built.error);
  }
  return built.tree;
}

function line(
  evaluation: EngineEvaluation,
  pvUci: readonly string[],
): Parameters<typeof liveClassificationForMove>[0]['lines'][number] {
  return { multipv: 1, evaluation, principalVariation: pvUci.map((uci) => ({ uci })), wdl: null };
}

function linesOf(...items: Array<ReturnType<typeof line>>): ReturnType<typeof line>[] {
  return items;
}

function positionOf(tree: MoveTree, san: string): { before: PositionLike; after: PositionLike } {
  const { tokens } = buildMoveListModel(tree);
  const token = tokens.find((t) => t.ply.san === san);
  if (!token) {
    throw new Error(`no token for ${san}`);
  }
  const before = positionAtPath(tree, token.path.slice(0, -1));
  const after = positionAtPath(tree, token.path);
  return { before, after };
}

// Position is the chessops Position; we only pass it through to the helpers.
type PositionLike = ReturnType<typeof positionAtPath>;

describe('liveClassificationForMove (ephemeral ADR-023)', () => {
  it('classifies a played best move as best when it matches the engine line', () => {
    const tree = treeOf('1. e4 e5');
    const { before, after } = positionOf(tree, 'e4');
    const classification = liveClassificationForMove(
      { position: before, lines: linesOf(line({ cp: 20 }, ['e2e4'])) },
      { position: after, lines: linesOf(line({ cp: -10 }, ['e7e5'])) },
      { from: 'e2', to: 'e4', promotion: undefined, san: 'e4' },
    );
    expect(classification).toBe('best');
  });

  it('classifies a decisive evaluation swing as a blunder', () => {
    const tree = treeOf('1. e4 e5');
    const { before, after } = positionOf(tree, 'e4');
    // Engine prefers d4; after the played move Black is overwhelmingly better.
    const classification = liveClassificationForMove(
      { position: before, lines: linesOf(line({ cp: 0 }, ['d2d4'])) },
      { position: after, lines: linesOf(line({ cp: 1000 }, ['d7d5'])) },
      { from: 'e2', to: 'e4', promotion: undefined, san: 'e4' },
    );
    expect(classification).toBe('blunder');
  });

  it('returns null until both neighbouring positions have engine lines', () => {
    const tree = treeOf('1. e4 e5');
    const { before, after } = positionOf(tree, 'e4');
    expect(
      liveClassificationForMove(
        { position: before, lines: [] },
        { position: after, lines: linesOf(line({ cp: 0 }, ['e7e5'])) },
        { from: 'e2', to: 'e4', promotion: undefined, san: 'e4' },
      ),
    ).toBeNull();
    expect(
      liveClassificationForMove(
        { position: before, lines: linesOf(line({ cp: 0 }, ['e2e4'])) },
        { position: after, lines: [] },
        { from: 'e2', to: 'e4', promotion: undefined, san: 'e4' },
      ),
    ).toBeNull();
  });

  it('exposes the UCI token of a played ply', () => {
    expect(uciOfPly({ from: 'e7', to: 'e8', promotion: 'queen' })).toBe('e7e8q');
    expect(uciOfPly({ from: 'g1', to: 'f3', promotion: undefined })).toBe('g1f3');
  });
});

describe('liveClassificationForTree', () => {
  it('classifies plies whose before/after positions both have live results', () => {
    const tree = treeOf('1. e4 e5 2. Nf3 Nc6');
    const { tokens } = buildMoveListModel(tree);
    const linesByFen: Record<string, ReturnType<typeof line>[]> = {};
    for (const token of tokens) {
      const before = positionAtPath(tree, token.path.slice(0, -1));
      const after = positionAtPath(tree, token.path);
      linesByFen[fenOf(before)] = linesOf(line({ cp: 0 }, [uciFrom(token.ply)]));
      linesByFen[fenOf(after)] = linesOf(line({ cp: 0 }, []));
    }
    // Give every analysed position a "best = the played move" answer so every
    // ply whose before+after both exist classifies as best.
    const result = liveClassificationForTree(tree, linesByFen);
    expect(result.size).toBe(tokens.length);

    // Missing engine data → no classification for those plies.
    const partial: Record<string, ReturnType<typeof line>[]> = {};
    const e4 = tokens.find((t) => t.ply.san === 'e4')!;
    const beforeE4 = positionAtPath(tree, e4.path.slice(0, -1));
    const afterE4 = positionAtPath(tree, e4.path);
    partial[fenOf(beforeE4)] = linesOf(line({ cp: 0 }, ['e2e4']));
    partial[fenOf(afterE4)] = linesOf(line({ cp: 0 }, ['e7e5']));
    const partialResult = liveClassificationForTree(tree, partial);
    expect(partialResult.size).toBe(1);
    expect(partialResult.get(e4.ply.id)).toBe('best');
  });
});

function uciFrom(ply: { from: string; to: string; promotion?: string | undefined }): string {
  return `${ply.from}${ply.to}${ply.promotion ? ply.promotion[0] : ''}`;
}
