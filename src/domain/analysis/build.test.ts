import { describe, expect, it } from 'vitest';
import { fixtureGame } from '@/domain/chess/fixtures';
import type { EngineMetadata, EvalCpMate, Wdl } from '@/domain/chess';
import { createAnalysisJob } from './job';
import { planGameAnalysis } from './plan';
import { buildMoveAnalyses, negateEval, swapWdl, type InputPositionResult } from './build';

const ENGINE: EngineMetadata = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

const WDL: Wdl = { w: 500, d: 480, l: 20 };

function evalCp(cp: number): EvalCpMate {
  return { cp, mate: null };
}

function result(fen: string, cp: number, uci: readonly string[]): InputPositionResult {
  return {
    fen,
    profile: 'normal',
    lines: [{ multipv: 1, uci, evaluation: evalCp(cp), wdl: WDL }],
  };
}

function run(
  gameId: string,
  cpByFen: Map<string, number>,
  uciByFen: Map<string, readonly string[]>,
) {
  const game = fixtureGame(gameId);
  const planResult = planGameAnalysis(game);
  if (!planResult.ok) throw new Error(planResult.message);
  const { moves, analyzeFens } = planResult.plan;
  const results = new Map<string, InputPositionResult>();
  for (const fen of analyzeFens) {
    results.set(fen, result(fen, cpByFen.get(fen) ?? 0, uciByFen.get(fen) ?? []));
  }
  const job = createAnalysisJob(game.id, ENGINE, analyzeFens.length, 1_700_000_000_000);
  return buildMoveAnalyses({ job, moves, results, nowMs: 1_700_000_000_000 });
}

describe('buildMoveAnalyses', () => {
  it('emits one record per planned ply with identity, version and engine metadata', () => {
    const game = fixtureGame('cc-blitz-clean');
    const plan = planGameAnalysis(game);
    if (!plan.ok) throw new Error(plan.message);
    const { moves, analyzeFens } = plan.plan;
    const results = new Map<string, InputPositionResult>();
    for (const fen of analyzeFens) {
      results.set(fen, result(fen, 0, []));
    }
    const job = createAnalysisJob(game.id, ENGINE, analyzeFens.length, 1);
    const records = buildMoveAnalyses({ job, moves, results, nowMs: 2 });

    expect(records).toHaveLength(moves.length);
    for (const [index, record] of records.entries()) {
      expect(record.analysisId).toBe(job.id);
      expect(record.gameId).toBe(game.id);
      expect(record.ply).toBe(index);
      expect(record.engine).toBe(ENGINE);
      expect(record.classificationVersion).toBe(1);
      expect(record.gamePhaseVersion).toBe(1);
      expect(record.missedTactic).toBe(false);
      expect(record.detectionVersion).toBeNull();
      expect(record.analysisVersion).toBe(job.analysisVersion);
      expect(record.positionFen).toBe(moves[index]!.positionFen);
    }
  });

  it('negates the following position evaluation into the mover perspective', () => {
    // 1.f3 e5 2.g4?? Qh4#: move 0 is White's f3 from the start position.
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const records = run('cc-bullet-blunder', new Map(), new Map());
    const first = records[0]!;
    expect(first.playedMove).toEqual({ san: 'f3', uci: 'f2f3' });
    expect(first.evalBefore).toEqual(evalCp(0));
    // evalAfter comes from the position after f3, negated into White's view.
    expect(first.evalAfter.cp).not.toBeNull();
    expect(first.positionFen).toBe(start);
  });

  it('classifies a blunder when the played move collapses the evaluation', () => {
    const game = fixtureGame('cc-bullet-blunder');
    const plan = planGameAnalysis(game);
    if (!plan.ok) throw new Error(plan.message);
    const { moves, analyzeFens } = plan.plan;

    const results = new Map<string, InputPositionResult>();
    for (const fen of analyzeFens) {
      results.set(fen, result(fen, 0, []));
    }
    // Position before 2.g4 (White to move): engine prefers e2e4.
    const beforeG4 = moves[2]!.positionFen;
    results.set(beforeG4, result(beforeG4, 0, ['e2e4', 'e7e5']));
    // Position after 2.g4 (Black to move): Black is winning (+1000).
    const afterG4 = moves[2]!.fenAfter;
    results.set(afterG4, result(afterG4, 1000, ['d8h4']));

    const job = createAnalysisJob(game.id, ENGINE, analyzeFens.length, 1);
    const records = buildMoveAnalyses({ job, moves, results, nowMs: 1 });
    const blunder = records[2]!;
    expect(blunder.playedMove.uci).toBe('g2g4');
    expect(blunder.evalBefore.cp).toBe(0);
    expect(blunder.evalAfter.cp).toBe(-1000);
    expect(blunder.classification).toBe('blunder');
  });

  it('handles a terminal last move (mate) without an engine result for it', () => {
    const records = run('cc-bullet-blunder', new Map(), new Map());
    const last = records[3]!;
    expect(last.playedMove).toEqual({ san: 'Qh4#', uci: 'd8h4' });
    expect(last.evalAfter).toEqual({ cp: 10000, mate: null });
    expect(last.wdlAfter).toEqual({ w: 1000, d: 0, l: 0 });
  });

  it('wdlAfter swaps perspective to the mover', () => {
    expect(swapWdl({ w: 100, d: 200, l: 700 })).toEqual({ w: 700, d: 200, l: 100 });
    expect(negateEval(evalCp(30))).toEqual(evalCp(-30));
    expect(negateEval({ cp: null, mate: 2 })).toEqual({ cp: null, mate: -2 });
  });
});
