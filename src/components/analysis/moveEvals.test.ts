import { describe, expect, it } from 'vitest';
import { fenOf } from '@/domain/chess';
import { buildTreeFromPgn } from '@/components/chessboard/positionTree';
import { positionAtPath } from '@/components/chessboard/positionTree';
import { buildPlyEvaluations } from './moveEvals';

describe('buildPlyEvaluations', () => {
  const tree = buildTreeFromPgn('1. e4 e5 2. Nf3').tree;
  const main = tree.rootChildren[0]!;
  const reply = main.children[0]!;
  const second = reply.children[0]!;

  it('returns an empty map when nothing has been analysed', () => {
    expect(buildPlyEvaluations(tree, {}).size).toBe(0);
  });

  it('formats each analysed ply from White’s perspective', () => {
    const afterMain = fenOf(positionAtPath(tree, [main]));
    const afterReply = fenOf(positionAtPath(tree, [main, reply]));
    // Engine reports side-to-move. After 1. e4 (Black to move) a +1.00
    // side-to-move score means Black is better, so White sees -1.00.
    const evals = {
      [afterMain]: { cp: 100 },
      [afterReply]: { cp: -50 },
    };
    const map = buildPlyEvaluations(tree, evals);
    expect(map.get(main.id)).toBe('-1.00');
    // After 1... e5 (White to move) a -0.50 side-to-move score is already
    // White-negative.
    expect(map.get(reply.id)).toBe('-0.50');
    expect(map.get(second.id)).toBeUndefined();
  });

  it('keeps mate signs consistent from White’s perspective', () => {
    const afterMain = fenOf(positionAtPath(tree, [main]));
    const evals = { [afterMain]: { mate: -2 } };
    const map = buildPlyEvaluations(tree, evals);
    // Black to move reports mate -2: Black is mated by White in 2 → from
    // White's perspective that is a positive M2.
    expect(map.get(main.id)).toBe('M2');
  });
});
