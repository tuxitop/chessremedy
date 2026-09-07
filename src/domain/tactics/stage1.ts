/**
 * Tactical detection Stage 1 — candidate generation (Feature 010, plan 013).
 *
 * Pure, deterministic filter over persisted `MoveAnalysis` records. Stage 1 v2
 * uses the position-centric candidate model ported from the lichess-puzzler
 * generator (method + thresholds only — no code copied; AGPL source used as a
 * reference, specs/research/tactical-detection.md): a candidate is emitted for
 * a user ply when a tactic was *available on the user's turn* and the user did
 * not play the engine's best move, not only when the played move lost >= 5
 * win-%. No engine work happens here; Stage 2 (verification) consumes the
 * result.
 *
 * ## Candidate rules (any of the following fires for one user ply)
 *
 * 1. **Today's rule (kept).** The played move's win-% loss is >= the ADR-023
 *    inaccuracy floor (`WPLOSS_INACCURACY`, 5 win-%).
 * 2. **Opponent-conceded swing.** The opponent's immediately-previous ply
 *    conceded >= `CONCEDED_SWING_MIN_WPLOSS` win-% to the user (measured from
 *    the opponent ply's own evalBefore/evalAfter, mover-normalized: the
 *    opponent's win-% drop is the user's gain). A tactic is "there" right
 *    after the opponent's error and the user failed to punish it.
 * 3. **Missed decisive / missed mate.** The user's evalBefore is already
 *    decisive for the user — a forced user mate within `MISSED_MATE_MAX_PLIES`
 *    or a user-perspective centipawn edge >= `MISSED_WINNING_MIN_CP` — yet the
 *    played move was not the engine's best. (Lichess rejects these for its
 *    public DB as trivial; personal training wants exactly "I missed the win".)
 * 4. **Quiet / small-loss miss.** The played move lost only `[1, 5)` win-% but
 *    the engine's best first move is forcing (a check or a capture), so a real
 *    tactic was there despite the small swing.
 *
 * The result is capped at `MAX_CANDIDATES_PER_GAME` and ordered by the swing
 * magnitude (win-% the user left on the board, or the conceded swing), so an
 * error-heavy game never triggers an unbounded verification load (Q3 = 16).
 *
 * ## Evaluation perspective
 *
 * Every `MoveAnalysis` evaluation is stored from the **mover's** perspective
 * (analysis-model.md): a ply by `userColor` is directly comparable, a ply by
 * the opponent is re-expressed through the symmetric `winPercent` curve
 * (`winPercentFromCp(-cp) === 100 - winPercentFromCp(cp)`).
 */

import type { Color } from 'chessops/types';
import { cpValueOf, winPercentFromCp, WPLOSS_INACCURACY } from '@/domain/chess';
import type { EvalCpMate, MoveAnalysis } from '@/domain/chess';
import { walkLine } from './line';
import { CANDIDATE_GENERATION_VERSION } from './types';
import type { RawCandidate } from './types';

/** Per-game Stage-1 cap: at most this many candidates reach Stage 2 (Q3 = 16). */
export const MAX_CANDIDATES_PER_GAME = 16;

/**
 * Rule-2 floor: the opponent's last move must have conceded at least this many
 * win-% points to the user (its own mover-normalized win-% drop) for the ply
 * to count as "the opponent just gave the user a tactic to punish".
 */
export const CONCEDED_SWING_MIN_WPLOSS = 25;

/** Rule-3: a user-perspective centipawn edge at/above this is "already winning". */
export const MISSED_WINNING_MIN_CP = 300;

/** Rule-3: a user forced mate within this many plies is a missed mate. */
export const MISSED_MATE_MAX_PLIES = 8;

/** Rule-4: lower bound of the quiet-miss band (`[1, 5)` win-%). */
export const QUIET_MISS_MIN_WPLOSS = 1;

/** Plies a forced mate value of `n` (UCI `mate n`) maps to for the mating side. */
function matePlies(mate: number): number {
  return Math.abs(mate) * 2 - 1;
}

function hasEval(evaluation: EvalCpMate): boolean {
  return evaluation.cp !== null || evaluation.mate !== null;
}

/** Mover-perspective centipawn value (mates map to ±10 000, ADR-023). */
function moverCp(evaluation: EvalCpMate): number {
  return cpValueOf(evaluation);
}

/**
 * Win-% of an evaluation from the **user's** perspective. `mover` is the side
 * the evaluation belongs to; a mover-perspective score is re-expressed for the
 * user via the symmetric curve when the two differ.
 */
function userWinPercent(evaluation: EvalCpMate, mover: Color, user: Color): number {
  const cp = moverCp(evaluation);
  return mover === user ? winPercentFromCp(cp) : winPercentFromCp(-cp);
}

/**
 * Full-scale win-% used for candidate ordering only: a forced mate for the side
 * reads as `100` (not the clamped ~97.6 of a ±1000 cp mate), so a missed mate
 * from an already-forced position ranks at the top of the cap. `null` when the
 * evaluation is a mate *against* the reference side (treated as `0` below via
 * the negated mate branch).
 */
function winPercentForRanking(evaluation: EvalCpMate, mover: Color, user: Color): number {
  if (evaluation.mate !== null) {
    const userMates = mover === user ? evaluation.mate > 0 : evaluation.mate < 0;
    return userMates ? 100 : 0;
  }
  return userWinPercent(evaluation, mover, user);
}

function clampTo100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** True when the ply's engine best move (its first UCI token) is a check/capture. */
function bestFirstMoveForcing(positionFen: string, bestMoveUci: string): boolean {
  const walked = walkLine(positionFen, [bestMoveUci]);
  if (!walked.ok) {
    return false;
  }
  const first = walked.walk.plies[0];
  return first !== undefined && (first.isCheck || first.isCapture);
}

/** True when the user had a forced mate within `MISSED_MATE_MAX_PLIES`. */
function hasForcedMate(evaluation: EvalCpMate, mover: Color, user: Color): boolean {
  if (evaluation.mate === null) {
    return false;
  }
  const userMates = mover === user ? evaluation.mate > 0 : evaluation.mate < 0;
  return userMates && matePlies(evaluation.mate) <= MISSED_MATE_MAX_PLIES;
}

export function generateCandidates(
  records: readonly MoveAnalysis[],
  userColor: Color,
  now: number,
): RawCandidate[] {
  const byPly = new Map<number, MoveAnalysis>();
  for (const record of records) {
    byPly.set(record.ply, record);
  }

  const candidates: Array<{ readonly candidate: RawCandidate; readonly swing: number }> = [];
  for (const record of records) {
    if (record.side !== userColor) {
      continue;
    }
    if (record.inBook) {
      continue;
    }
    if (record.bestMove === null || record.playedMove.uci === record.bestMove.uci) {
      continue;
    }
    if (!hasEval(record.evalBefore) || !hasEval(record.evalAfter)) {
      continue;
    }

    const mover = record.side;
    const wpBefore = userWinPercent(record.evalBefore, mover, userColor);
    const wpAfter = userWinPercent(record.evalAfter, mover, userColor);
    const wpLoss = clampTo100(wpBefore - wpAfter);

    // Rule 1 — today's rule (played move crossed the ADR-023 inaccuracy band).
    let fires = wpLoss >= WPLOSS_INACCURACY;
    // The swing magnitude used to order candidates inside the per-game cap.
    let swing = wpLoss;

    // Rule 2 — opponent-conceded swing: the opponent's immediately-previous
    // ply dropped its own win-% by at least the threshold (mover-normalized:
    // the opponent's loss is the user's gain). The tactic is available on the
    // user's turn right after the opponent's error.
    const previous = byPly.get(record.ply - 1);
    if (!fires && previous !== undefined && previous.side !== userColor) {
      if (hasEval(previous.evalBefore) && hasEval(previous.evalAfter)) {
        const conceded = clampTo100(
          winPercentFromCp(moverCp(previous.evalBefore)) -
            winPercentFromCp(moverCp(previous.evalAfter)),
        );
        if (conceded >= CONCEDED_SWING_MIN_WPLOSS) {
          fires = true;
          swing = Math.max(swing, conceded);
        }
      }
    }

    // Rule 3 — missed decisive / missed mate: the position before was already
    // winning for the user (a forced mate within the window, or a >= +300 edge
    // from the user's perspective) yet the best move was not played.
    if (!fires) {
      const beforeCp = moverCp(record.evalBefore);
      const userCpBefore = mover === userColor ? beforeCp : -beforeCp;
      if (
        userCpBefore >= MISSED_WINNING_MIN_CP ||
        hasForcedMate(record.evalBefore, mover, userColor)
      ) {
        fires = true;
        // Ordering: how far the played move left the user from a full win.
        swing = Math.max(
          swing,
          clampTo100(
            winPercentForRanking(record.evalBefore, mover, userColor) -
              winPercentForRanking(record.evalAfter, mover, userColor),
          ),
        );
      }
    }

    // Rule 4 — quiet / small-loss miss: the move only lost `[1, 5)` win-% but
    // the engine's best first move was forcing (check/capture), so a real
    // tactic existed despite the small swing.
    if (!fires && wpLoss >= QUIET_MISS_MIN_WPLOSS && wpLoss < WPLOSS_INACCURACY) {
      if (bestFirstMoveForcing(record.positionFen, record.bestMove.uci)) {
        fires = true;
      }
    }

    if (!fires) {
      continue;
    }

    candidates.push({
      candidate: {
        id: `${record.analysisId}:${record.ply}`,
        analysisId: record.analysisId,
        sourceGameId: record.gameId,
        sourcePly: record.ply,
        startingFen: record.positionFen,
        userMovePlayed: record.playedMove.uci,
        bestMove: record.bestMove.uci,
        bestPv: record.bestPv,
        wpLoss,
        evalCpBefore: record.evalBefore.cp,
        evalCpAfterUserMove: record.evalAfter.cp,
        candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
        createdAt: now,
      },
      swing,
    });
  }

  // Cap + deterministic priority order: biggest swing first (the moment the
  // user left the most on the board), then earliest ply as the tiebreak.
  candidates.sort((a, b) => {
    if (b.swing !== a.swing) {
      return b.swing - a.swing;
    }
    return a.candidate.sourcePly - b.candidate.sourcePly;
  });
  return candidates.slice(0, MAX_CANDIDATES_PER_GAME).map((entry) => entry.candidate);
}
