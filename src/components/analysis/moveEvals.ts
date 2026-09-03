import { fenOf } from '@/domain/chess';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import { buildMoveListModel } from '@/components/chessboard/MoveList';
import { positionAtPath, type MoveTree } from '@/components/chessboard/positionTree';
import { formatWhiteEvaluation } from './engineFormat';

/**
 * Evaluations to render next to each ply in the move list. The engine reports
 * evaluations from the side-to-move perspective; the move list shows every
 * evaluation from White's perspective so the sign is stable across plies.
 *
 * Returns `ply.id → formatted eval` for every ply whose *resulting* position
 * has been analysed this session.
 */
export function buildPlyEvaluations(
  tree: MoveTree,
  evalsByFen: Readonly<Record<string, EngineEvaluation>>,
): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  if (Object.keys(evalsByFen).length === 0) return out;
  const { tokens } = buildMoveListModel(tree);
  for (const token of tokens) {
    const position = positionAtPath(tree, token.path);
    const fen = fenOf(position);
    const evaluation = evalsByFen[fen];
    if (evaluation !== undefined) {
      out.set(token.ply.id, formatWhiteEvaluation(evaluation, fen));
    }
  }
  return out;
}
