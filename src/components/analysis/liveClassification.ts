/**
 * Ephemeral live classification of moves analysed on the shared board.
 *
 * When the engine is live, each visited position's freshest engine lines are
 * kept (per FEN). A move between two positions can then be classified exactly
 * like a persisted `MoveAnalysis` (ADR-023): `evalBefore` is the live engine
 * evaluation of the position before the move (side to move = the mover),
 * `evalAfter` is the live evaluation of the position after the move re-expressed
 * from the mover's perspective, and the engine's top line at the parent gives
 * the best move / best-move-tie context. Classifications are presentation-only:
 * they never touch persisted `MoveAnalysis` records.
 *
 * Pure and deterministic — no React/DB/Worker dependencies.
 */

import type { Position } from 'chessops/chess';
import type { MoveClassification } from '@/domain/chess';
import type { EvalCpMate } from '@/domain/chess';
import type { EngineEvaluation, EngineLine } from '@/infrastructure/engine/types';
import { classifyMove, cpValueOf } from '@/domain/chess/classification';
import { gamePhaseOf } from '@/domain/chess/gamePhase';
import { fenOf } from '@/domain/chess';
import { countLegalMoves } from '@/domain/analysis';
import { buildMoveListModel } from '@/components/chessboard/MoveList';
import { positionAtPath, type MovePly, type MoveTree } from '@/components/chessboard/positionTree';

/** UCI token for a played ply (`from` + `to` + promotion role letter). */
export function uciOfPly(ply: Pick<MovePly, 'from' | 'to' | 'promotion'>): string {
  const promotion = ply.promotion ? ply.promotion[0] : '';
  return `${ply.from}${ply.to}${promotion}`;
}

function evaluationToCpMate(evaluation: EngineEvaluation): EvalCpMate {
  return 'mate' in evaluation
    ? { cp: null, mate: evaluation.mate }
    : { cp: evaluation.cp, mate: null };
}

function negate(evaluation: EvalCpMate): EvalCpMate {
  return {
    cp: evaluation.cp !== null ? -evaluation.cp : null,
    mate: evaluation.mate !== null ? -evaluation.mate : null,
  };
}

/** Best (multipv 1) engine line of a result, or the first line. */
function bestLine(lines: readonly EngineLine[]): EngineLine | undefined {
  return lines.find((line) => (line.multipv ?? 1) === 1) ?? lines[0];
}

/**
 * Classify one live move from the engine results of the two positions it
 * connects. Returns `null` when either side has no usable engine result yet
 * (or the position before has no legal moves).
 */
export function liveClassificationForMove(
  before: { position: Position; lines: readonly EngineLine[] },
  after: { position: Position; lines: readonly EngineLine[] },
  played: Pick<MovePly, 'from' | 'to' | 'promotion' | 'san'>,
): MoveClassification | null {
  const bestBefore = bestLine(before.lines);
  const bestAfter = bestLine(after.lines);
  if (!bestBefore || !bestAfter) {
    return null;
  }
  if (bestBefore.evaluation === undefined || bestAfter.evaluation === undefined) {
    return null;
  }
  const bestUci = bestBefore.principalVariation[0]?.uci;
  if (!bestUci) {
    return null;
  }
  const legalMovesCount = countLegalMoves(before.position);
  if (legalMovesCount === 0) {
    return null;
  }
  return classifyMove({
    evalBefore: evaluationToCpMate(bestBefore.evaluation),
    evalAfter: negate(evaluationToCpMate(bestAfter.evaluation)),
    // The engine's best line is keyed by UCI; the played move keeps its SAN so
    // the two never collide on the (unused) SAN comparison in `sameMove`.
    bestMove: { san: '', uci: bestUci },
    playedMove: { san: played.san, uci: uciOfPly(played) },
    legalMovesCount,
    wdlBefore: bestBefore.wdl ?? null,
    wdlAfter: bestAfter.wdl ?? null,
    gamePhase: gamePhaseOf(before.position),
    inBook: false,
    topCpValues: before.lines.map((line) =>
      line.evaluation !== undefined ? cpValueOf(evaluationToCpMate(line.evaluation)) : 0,
    ),
  });
}

/**
 * Classify every ply of a tree whose before/after positions both have live
 * engine results this session. `ply.id → classification`.
 */
export function liveClassificationForTree(
  tree: MoveTree,
  linesByFen: Readonly<Record<string, readonly EngineLine[]>>,
): ReadonlyMap<number, MoveClassification> {
  const out = new Map<number, MoveClassification>();
  if (Object.keys(linesByFen).length === 0) {
    return out;
  }
  const { tokens } = buildMoveListModel(tree);
  for (const token of tokens) {
    const afterPosition = positionAtPath(tree, token.path);
    const afterLines = linesByFen[fenOf(afterPosition)];
    if (!afterLines || afterLines.length === 0) {
      continue;
    }
    const beforePosition = positionAtPath(tree, token.path.slice(0, -1));
    const beforeLines = linesByFen[fenOf(beforePosition)];
    if (!beforeLines || beforeLines.length === 0) {
      continue;
    }
    const classification = liveClassificationForMove(
      { position: beforePosition, lines: beforeLines },
      { position: afterPosition, lines: afterLines },
      token.ply,
    );
    if (classification) {
      out.set(token.ply.id, classification);
    }
  }
  return out;
}
