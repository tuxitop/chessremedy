/**
 * Deterministic `MoveAnalysis` fixture scenarios for Feature-009
 * classification & accuracy tooling.
 *
 * Test-only (never imported by production modules). These arrays model the
 * records the Feature-008 pipeline persists: five-state classifications,
 * stored engine metadata and exact eval pairs so classification counts and
 * accuracy values are known up front. Where a record's classification is
 * `good`/`inaccuracy`/`mistake`, the stored `bestMove` differs from the
 * played move and the eval pair implies the matching ADR-023 bucket, so
 * `classifyMove` reproduces the stored label. `blunderGameRecords` mirrors
 * the `cc-bullet-blunder` review fixture game used by the Game Review page.
 */

import { makeMove, makeEngine } from '../test-support';
import type { EngineMetadata, MoveAnalysis, PlayedMove } from '@/domain/chess';

const D4: PlayedMove = { san: 'd4', uci: 'd2d4' };
const C4: PlayedMove = { san: 'c4', uci: 'c2c4' };
const NF3: PlayedMove = { san: 'Nf3', uci: 'g1f3' };
const NC3: PlayedMove = { san: 'Nc3', uci: 'b1c3' };
const D5: PlayedMove = { san: 'd5', uci: 'd7d5' };
const E6: PlayedMove = { san: 'e6', uci: 'e7e6' };
const NF6: PlayedMove = { san: 'Nf6', uci: 'g8f6' };

/** Eval pair implying `wpLoss < 2` (ordinary, ADR-023 `good`). */
const ORDINARY_EVAL = {
  evalBefore: { cp: 10, mate: null } as const,
  evalAfter: { cp: 0, mate: null } as const,
};

const ORDINARY_WDL = {
  wdlBefore: { w: 520, d: 470, l: 10 },
  wdlAfter: { w: 515, d: 475, l: 10 },
};

/**
 * The `cc-bullet-blunder` review line: 1.f3 e5 2.g4?? Qh4#. User is White.
 * f3/e5 are ordinary `good`, 2.g4 is a `blunder`, Qh4# is the engine's
 * `best` move. Used to drive the Game Review display tests.
 */
export function blunderGameRecords(gameId: string, analysisId: string): readonly MoveAnalysis[] {
  return [
    makeMove(0, {
      gameId,
      analysisId,
      side: 'white',
      playedMove: { san: 'f3', uci: 'f2f3' },
      bestMove: { san: 'e4', uci: 'e2e4' },
      evalBefore: { cp: 0, mate: null },
      evalAfter: { cp: -10, mate: null },
      classification: 'good',
    }),
    makeMove(1, {
      gameId,
      analysisId,
      side: 'black',
      playedMove: { san: 'e5', uci: 'e7e5' },
      bestMove: { san: 'd5', uci: 'd7d5' },
      evalBefore: { cp: 10, mate: null },
      evalAfter: { cp: 0, mate: null },
      classification: 'good',
    }),
    makeMove(2, {
      gameId,
      analysisId,
      side: 'white',
      playedMove: { san: 'g4', uci: 'g2g4' },
      bestMove: { san: 'Nf3', uci: 'g1f3' },
      // Mate-sign flip: after 2.g4 Black mates next move (evalAfter < 0).
      evalBefore: { cp: 0, mate: null },
      evalAfter: { cp: null, mate: -1 },
      classification: 'blunder',
    }),
    makeMove(3, {
      gameId,
      analysisId,
      side: 'black',
      playedMove: { san: 'Qh4#', uci: 'd8h4' },
      bestMove: { san: 'Qh4#', uci: 'd8h4' },
      classification: 'best',
    }),
  ];
}

/**
 * A "good-heavy" ordinary game: White is the user. The opening/book-like
 * first plies and most other plies are ordinary (`good`); the user has one
 * inaccuracy and one best move, the opponent one mistake.
 *
 * Classification per ply (alternating white/black from ply 0):
 * good, good, good, good, good, good, inaccuracy, good, good, mistake,
 * best, good.
 */
export function ordinaryGameRecords(gameId: string, analysisId: string): readonly MoveAnalysis[] {
  const common = { gameId, analysisId, ...ORDINARY_WDL, inBook: false };
  const goodMove = (ply: number, side: 'white' | 'black', played: PlayedMove, best: PlayedMove) =>
    makeMove(ply, {
      ...common,
      side,
      playedMove: played,
      bestMove: best,
      ...ORDINARY_EVAL,
      classification: 'good',
    });
  return [
    goodMove(0, 'white', C4, D4),
    goodMove(1, 'black', E6, D5),
    goodMove(2, 'white', NF3, C4),
    goodMove(3, 'black', NF6, D5),
    goodMove(4, 'white', NC3, D4),
    goodMove(5, 'black', E6, D5),
    // User inaccuracy: +20 → −10 is a 2.76% win loss (2 ≤ loss < 10).
    makeMove(6, {
      ...common,
      side: 'white',
      playedMove: NF3,
      bestMove: NC3,
      evalBefore: { cp: 20, mate: null },
      evalAfter: { cp: -10, mate: null },
      classification: 'inaccuracy',
    }),
    goodMove(7, 'black', NF6, D5),
    goodMove(8, 'white', NF3, C4),
    // Opponent mistake: +30 → −120 is a 13.6% win loss (10 ≤ loss < 20).
    makeMove(9, {
      ...common,
      side: 'black',
      playedMove: NF6,
      bestMove: D5,
      evalBefore: { cp: 30, mate: null },
      evalAfter: { cp: -120, mate: null },
      classification: 'mistake',
    }),
    makeMove(10, {
      ...common,
      side: 'white',
      playedMove: D4,
      bestMove: D4,
      ...ORDINARY_EVAL,
      classification: 'best',
    }),
    goodMove(11, 'black', E6, D5),
  ];
}

/**
 * A `fast`-profile fixture: every record has `wdlBefore/wdlAfter = null`,
 * so classification uses the phase-dependent centipawn fallback (ADR-023)
 * and accuracy relies on centipawn evaluations alone (ADR-024).
 *
 * Opening-phase classifications for cp losses 30 / 60 / 120 (thresholds
 * 50/100/200): good / inaccuracy / mistake.
 */
export function fastProfileRecords(gameId: string, analysisId: string): readonly MoveAnalysis[] {
  const engine: EngineMetadata = makeEngine('fast');
  const cpEval = (cp: number) => ({ cp, mate: null }) as const;
  const records = [
    makeMove(0, {
      gameId,
      analysisId,
      side: 'white',
      gamePhase: 'opening',
      wdlBefore: null,
      wdlAfter: null,
      playedMove: NF3,
      bestMove: D4,
      evalBefore: cpEval(0),
      evalAfter: cpEval(-30),
      classification: 'good',
    }),
    makeMove(1, {
      gameId,
      analysisId,
      side: 'black',
      gamePhase: 'opening',
      wdlBefore: null,
      wdlAfter: null,
      playedMove: E6,
      bestMove: D5,
      evalBefore: cpEval(0),
      evalAfter: cpEval(-60),
      classification: 'inaccuracy',
    }),
    makeMove(2, {
      gameId,
      analysisId,
      side: 'white',
      gamePhase: 'opening',
      wdlBefore: null,
      wdlAfter: null,
      playedMove: NF3,
      bestMove: D4,
      evalBefore: cpEval(0),
      evalAfter: cpEval(-120),
      classification: 'mistake',
    }),
  ];
  return records.map((record) => ({ ...record, engine }));
}
