import { describe, expect, it } from 'vitest';
import { fenOf } from '@/domain/chess';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import { makeMove } from '@/domain/analysis/test-support';
import { positionAtPath, pathToEnd } from './positionTree';
import { buildSolveLine, mainlinePathOf, puzzlePrefixOf, playUci } from './puzzleMoveLine';

const STANDARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function fenAfter(moves: readonly string[], depth: number): string {
  const line = buildSolveLine({ startFen: STANDARD, mainline: moves });
  return fenOf(positionAtPath(line.tree, mainlinePathOf(line.tree, depth)));
}

function recordsFor(gameId: string, analysisId: string, moves: readonly string[]) {
  return moves.map((uci, ply) =>
    makeMove(ply, {
      gameId,
      analysisId,
      playedMove: { san: '', uci },
      positionFen: fenAfter(moves, ply),
    }),
  );
}

describe('puzzleMoveLine (plan 012b stage A)', () => {
  it('reconstructs a prefix tree whose mainline ends at the puzzle start FEN', () => {
    const prefix = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
    const built = buildSolveLine({ startFen: STANDARD, mainline: prefix });
    expect(built.error).toBeUndefined();
    const endFen = fenOf(positionAtPath(built.tree, pathToEnd(built.tree, [])));
    expect(pathToEnd(built.tree, [])).toHaveLength(prefix.length);
    // White to move after 2…Nc6.
    expect(endFen.split(/\s+/)[1]).toBe('w');
  });

  it('appends a wrong attempt as a variation sibling of the mainline move at its decision node', () => {
    const mainline = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
    const line = buildSolveLine({
      startFen: STANDARD,
      mainline,
      variations: [{ depth: 4, uci: 'd2d4' }],
    });
    expect(line.error).toBeUndefined();
    const decisionPath = mainlinePathOf(line.tree, 4);
    const decisionNode = decisionPath[decisionPath.length - 1];
    const children = decisionNode?.children ?? [];
    // The mainline continuation stays first; the wrong attempt is a sibling.
    expect(children[0]?.san).toBe('Bc4');
    expect(children.some((s) => s.san === 'd4')).toBe(true);
  });

  it('playUci replays a single UCI token onto the mainline end', () => {
    const built = buildSolveLine({ startFen: STANDARD, mainline: [] });
    const result = playUci(built.tree, [], 'e2e4');
    expect(result.path).toHaveLength(1);
    expect(result.path[0]?.san).toBe('e4');
  });

  it('puzzlePrefixOf slices records up to the source ply and replays them from the first record FEN', () => {
    const row = {
      ...puzzleRowFixture('mate-one'),
      sourceGameId: 'fixture:prefix-game',
      sourcePly: 4,
      analysisId: 'analysis:prefix-game',
    };
    const records = recordsFor('fixture:prefix-game', 'analysis:prefix-game', [
      'e2e4',
      'e7e5',
      'g1f3',
      'b8c6',
    ]);
    const prefix = puzzlePrefixOf(row, records);
    expect(prefix?.tokens).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(prefix?.startFen).toBe(STANDARD);
  });

  it('returns null when there are no usable prefix records', () => {
    const row = {
      ...puzzleRowFixture('mate-one'),
      sourceGameId: 'fixture:prefix-game',
      sourcePly: 4,
      analysisId: 'analysis:prefix-game',
    };
    expect(puzzlePrefixOf(row, [])).toBeNull();
  });
});
