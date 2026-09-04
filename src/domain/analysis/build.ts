/**
 * Engine results → persisted `MoveAnalysis` records (Feature 008).
 *
 * Consumes a game's analysis plan (`domain/analysis/plan.ts`) plus engine
 * results for every planned position and emits the canonical `MoveAnalysis`
 * rows: classification (ADR-023) and game phase (specs/domain/game-phase.md)
 * are applied here from the canonical domain algorithms. `missedTactic` is
 * reserved (`false`, `detectionVersion: null`) — Feature 010 fills it later.
 *
 * Pure and deterministic: the same plan + results + job identity always
 * produce the same records.
 */

import { parsePositionFen } from '@/domain/chess/position';
import { uciPvToSan } from '@/domain/chess/san';
import type {
  EngineMetadata,
  EvalCpMate,
  MoveAnalysis,
  MultiPvLine,
  PlayedMove,
  Wdl,
} from '@/domain/chess';
import type { MoveClock } from '@/domain/chess/clock';
import { classifyMove, CLASSIFICATION_VERSION, cpValueOf } from '@/domain/chess/classification';
import { GAME_PHASE_VERSION } from '@/domain/chess/gamePhase';
import type { AnalysisJob } from './job';
import type { PlannedMove } from './plan';

/** Domain-neutral engine result for one position (adapter output). */
export interface InputLine {
  readonly multipv: number;
  /** Principal variation as UCI tokens from the analyzed position. */
  readonly uci: readonly string[];
  readonly evaluation: EvalCpMate;
  readonly wdl: Wdl | null;
  /** Search depth reached, when the engine reported it. */
  readonly depth?: number;
}

export interface InputPositionResult {
  readonly fen: string;
  readonly profile: EngineMetadata['profile'];
  readonly lines: readonly InputLine[];
}

export interface BuildInput {
  readonly job: AnalysisJob;
  readonly moves: readonly PlannedMove[];
  /** Results keyed by the canonical FEN of every planned position. */
  readonly results: ReadonlyMap<string, InputPositionResult>;
  /** Mainline clocks (mover's remaining time after each move), when present. */
  readonly clocks?: readonly MoveClock[];
  readonly nowMs: number;
}

/** Swap a WDL triplet to the opposite perspective (w ↔ l). */
export function swapWdl(wdl: Wdl): Wdl {
  return { w: wdl.l, d: wdl.d, l: wdl.w };
}

/** Negate an evaluation to the opposite side's perspective. */
export function negateEval(evaluation: EvalCpMate): EvalCpMate {
  return {
    cp: evaluation.cp !== null ? -evaluation.cp : null,
    mate: evaluation.mate !== null ? -evaluation.mate : null,
  };
}

/**
 * Evaluation of a terminal position after a move, from the mover's
 * perspective. A terminal position with the opponent to move is a win for the
 * mover only when it is checkmate (the mover delivered mate); stalemate and
 * insufficient material are draws.
 */
export function terminalEvalFor(
  fenAfter: string,
  withWdl: boolean,
): {
  readonly evalAfter: EvalCpMate;
  readonly wdlAfter: Wdl | null;
} {
  const parsed = parsePositionFen(fenAfter);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const moverWon = parsed.position.isCheckmate();
  const evalAfter: EvalCpMate = { cp: moverWon ? 10_000 : 0, mate: null };
  const wdlAfter: Wdl | null = withWdl
    ? moverWon
      ? { w: 1000, d: 0, l: 0 }
      : { w: 0, d: 1000, l: 0 }
    : null;
  return { evalAfter, wdlAfter };
}

function bestMoveOf(positionFen: string, uci: readonly string[]): PlayedMove | null {
  const first = uci[0];
  if (!first) {
    return null;
  }
  const converted = uciPvToSan(positionFen, [first]);
  return converted.ok ? { san: converted.sans[0]!, uci: first } : { san: first, uci: first };
}

function missingResult(fen: string): Error {
  return new Error(`Missing engine result for position: ${fen}`);
}

/**
 * Build the persisted `MoveAnalysis` records for a game. Throws when a planned
 * non-terminal position has no engine result — callers only invoke this after
 * every planned position resolved (a failed engine job never reaches here).
 */
export function buildMoveAnalyses(input: BuildInput): readonly MoveAnalysis[] {
  const { job, moves, results, nowMs } = input;
  const clockByPly = new Map<number, number>();
  for (const clock of input.clocks ?? []) {
    clockByPly.set(clock.ply, clock.clockMs);
  }
  const records: MoveAnalysis[] = [];

  for (const move of moves) {
    const resultBefore = results.get(move.positionFen);
    if (!resultBefore || resultBefore.lines.length === 0) {
      throw missingResult(move.positionFen);
    }
    const top = resultBefore.lines[0]!;
    const evalBefore = top.evaluation;
    const wdlBefore = top.wdl;
    const bestPv = top.uci;

    let evalAfter: EvalCpMate;
    let wdlAfter: Wdl | null;
    if (move.terminalAfter) {
      const terminal = terminalEvalFor(move.fenAfter, wdlBefore !== null);
      evalAfter = terminal.evalAfter;
      wdlAfter = terminal.wdlAfter;
    } else {
      const resultAfter = results.get(move.fenAfter);
      if (!resultAfter || resultAfter.lines.length === 0) {
        throw missingResult(move.fenAfter);
      }
      const afterTop = resultAfter.lines[0]!.evaluation;
      evalAfter = negateEval(afterTop);
      const afterWdl = resultAfter.lines[0]!.wdl;
      wdlAfter = afterWdl !== null ? swapWdl(afterWdl) : null;
    }

    const multipvLines: readonly MultiPvLine[] = resultBefore.lines.map((line) => ({
      multipv: line.multipv,
      uci: line.uci,
      evaluation: line.evaluation,
      wdl: line.wdl,
      ...(line.depth !== undefined ? { depth: line.depth } : {}),
    }));

    const classification = classifyMove({
      evalBefore,
      evalAfter,
      bestMove: bestMoveOf(move.positionFen, bestPv),
      playedMove: move.playedMove,
      legalMovesCount: move.legalMovesCount,
      wdlBefore,
      wdlAfter,
      gamePhase: move.gamePhase,
      inBook: false,
      topCpValues: resultBefore.lines.map((line) => cpValueOf(line.evaluation)),
    });

    const clockAfterMs = clockByPly.get(move.ply);

    records.push({
      analysisId: job.id,
      gameId: job.gameId,
      ply: move.ply,
      moveNumber: move.moveNumber,
      side: move.side,
      playedMove: move.playedMove,
      positionFen: move.positionFen,
      evalBefore,
      evalAfter,
      wdlBefore,
      wdlAfter,
      bestMove: bestMoveOf(move.positionFen, bestPv),
      bestPv,
      multipvLines,
      ...(top.depth !== undefined ? { depth: top.depth } : {}),
      ...(clockAfterMs !== undefined ? { clockAfterMs } : {}),
      legalMovesCount: move.legalMovesCount,
      inBook: false,
      classification,
      classificationVersion: CLASSIFICATION_VERSION,
      gamePhase: move.gamePhase,
      gamePhaseVersion: GAME_PHASE_VERSION,
      missedTactic: false,
      detectionVersion: null,
      engine: job.engine,
      analysisVersion: job.analysisVersion,
      analyzedAt: nowMs,
    });
  }

  return records;
}
