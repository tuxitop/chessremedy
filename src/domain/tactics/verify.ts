/**
 * Tactical detection Stage 2 — verification core (Feature 010, ADR-026).
 *
 * Pure, deterministic gate over one tactical-profile MultiPV result for a raw
 * candidate (research `tactical-detection.md` §3 step 2–3, §4, §5 and §10;
 * ADR-026 Stage 2). It walks the best engine line from the candidate's
 * starting position to the tactical objective, then applies every
 * false-positive guard and — on success — emits the verified candidate the
 * research §10 schema describes.
 *
 * This module consumes engine output through its own engine-free input type
 * (`TacticalVerificationInput`) so the domain never imports the engine layer.
 *
 * ## Evaluation-perspective convention (read before touching the guards)
 *
 * The engine run analyses `candidate.startingFen`, whose side to move IS the
 * candidate's mover (the side that missed the tactic). A UCI MultiPV line's
 * reported score is the negamax value of that line expressed for the analysed
 * root node's side to move, and the analysis domain treats engine-native
 * values of an analysed node as that node's mover-perspective values
 * (`analysis.ts` `evalBefore`, `build.ts` `multipvLines`). By the negamax
 * recursion the reported value equals the terminal position of the line
 * valued for the starting mover, so `TacticalCandidateLine` evaluations and
 * WDLs are ALREADY in the starting mover's perspective and need no parity
 * re-expression here — unlike `build.ts`, where a *separately analysed* node
 * (the opponent's reply) must be negated/swapped. Objective inputs therefore
 * satisfy the mover-perspective contract of `objective.ts` directly.
 *
 * ## Consequence for the "stabilisation" rule
 *
 * Research §3 step 2 stops the walk when the position stabilises ("no checks,
 * no captures, evalCp delta < 30 over two consecutive plies"). A verification
 * line carries a single terminal evaluation, so per-prefix centipawn values
 * do not exist; the module reads the cp-delta sub-condition as implied by the
 * forcing-free sub-condition: when two consecutive plies are neither checks
 * nor captures, no material can change (captures are the only material
 * source) and the single terminal evaluation cannot measure a prefix swing,
 * so `STABILISATION_CP_DELTA` is asserted trivially. Stabilisation therefore
 * reduces to "two consecutive forcing-free plies". This is precise and
 * deterministic; the cp-delta wording of the research is kept as the named
 * constant for when a per-prefix evaluation source is added.
 *
 * ## Objective-per-prefix gating
 *
 * The engine line is walked ply by ply and `classifyObjective` is evaluated
 * per prefix. Two gates keep eval-backed objectives honest given the single
 * terminal evaluation:
 * - `winning_material` requires **retention**: the gain must be irreversible
 *   through the walk window (the mover is still up `>= 3` at the stop point),
 *   so a prefix that temporarily nets a queen (an equal trade the PV
 *   recaptures) is never reported as a one-ply material win.
 * - `forcing_mate` only counts at a prefix whose walked end actually is
 *   checkmate (a prefix that delivers mate on the board) — an engine mate
 *   value reported for a longer line must not fire at an interior prefix.
 * - `decisive_advantage` / `neutralizing_threat` describe the completed
 *   line's end state (terminal evaluation vs the candidate start state), so
 *   they only count when the walked prefix IS the whole engine line.
 *
 * ## `>8-plies` vs `no-objective` (precise rule)
 *
 * Prefixes are scanned inside the `MAX_TACTIC_PLIES` window. If none reaches
 * an objective:
 * - the walk stopped early on stabilisation ⇒ `no-objective`;
 * - otherwise, if the engine line is longer than the window and some prefix
 *   beyond the window reaches an objective ⇒ `>8-plies` (the tactic exists
 *   but requires more than 8 plies);
 * - otherwise ⇒ `no-objective` (no objective anywhere in the line).
 *
 * ## Alternative-move guard reading
 *
 * The authoritative reading is ADR-026 ("reject if the tactical objective is
 * reachable by a non-forcing alternative") and research §1.4 ("not trivially
 * achievable by any alternative move"). The accuracy-phrased §5 guard 1
 * ("≥ 80 % of the best move") is superseded wording (plan §Deliverable 0):
 * only a NON-forcing alternative first move that independently reaches the
 * SAME objective rejects the candidate. Forcing alternatives that also reach
 * it are allowed and simply raise the difficulty estimate's candidate count.
 *
 * WDL-consistency and mate thresholds follow ADR-026 / research §3 step 3;
 * threshold changes must bump `DETECTION_VERSION` (ADR-026).
 *
 * ## Verified-candidate solution
 *
 * The verified candidate persists the **verified** line as its solution:
 * `bestMove`/`bestPv` are re-expressed from the tactical-profile top line
 * walked to the objective (research §10), so Feature 011 and Game Review never
 * consume a bulk-analysis PV that was not the line actually verified.
 */

import { ANALYSIS_VERSION } from '@/domain/chess';
import type { Wdl } from '@/domain/chess';
import { estimateDifficulty } from './difficulty';
import { forcingness, isTerminalDraw, materialDelta, walkLine } from './line';
import type { LineWalk } from './line';
import { classifyObjective, WINNING_MATERIAL_MIN_DELTA } from './objective';
import type { TacticalObjective } from './types';
import { DETECTION_VERSION } from './types';
import type { RawCandidate, VerifiedTacticalCandidate } from './types';

/** Rejection reasons of the Stage-2 verification (ADR-026 failure modes). */
export const VERIFICATION_REJECTION_REASONS = [
  'no-lines',
  'bad-line',
  'draw-line',
  'no-objective',
  '>8-plies',
  'non-forcing-alternative-reaches-objective',
  'wdl-inconsistent',
  'difficulty-below-15',
] as const;

export type VerificationRejectionReason = (typeof VERIFICATION_REJECTION_REASONS)[number];

/**
 * Longest solution allowed: an objective must be reached at or before this
 * many plies from the starting position (research §2 "≤ 8 plies", §3 step 2;
 * ADR-026 guard).
 */
export const MAX_TACTIC_PLIES = 8;

/**
 * Mover-perspective centipawn delta (research §3 step 2) that marks two quiet
 * plies as a stabilised position. Because a verification line carries a single
 * terminal evaluation, the delta cannot be measured per prefix; the constant
 * documents the research threshold that the forcing-free pair (see the module
 * header) implies.
 */
export const STABILISATION_CP_DELTA = 30;

/** Difficulty estimate floor for a verified candidate (ADR-025 / ADR-026). */
export const VERIFICATION_MIN_DIFFICULTY = 15;

/**
 * Mover losing share (per-mille) at the line end at or above which an end WDL
 * contradicts a `winning_material` / `decisive_advantage` objective (the end
 * "still shows the mover losing"; ADR-026 WDL guard). Aligned with the forced
 * loss per-mille used for `neutralizing_threat` in `objective.ts`.
 */
export const WDL_WINNING_END_MAX_LOSS_PERMILLE = 800;

/**
 * Mover winning share (per-mille) below which an end WDL contradicts a
 * `forcing_mate` objective: a forced mate is a deterministic mover win, so the
 * engine WDL must read `(1000, 0, 0)`.
 */
export const WDL_MATE_END_MIN_WIN_PERMILLE = 1000;

/** One MultiPV line of the tactical-profile verification run. */
export interface TacticalCandidateLine {
  /** MultiPV rank, 1..N (lines are expected rank-ordered, `lines[0]` best). */
  readonly multipv: number;
  /**
   * Evaluation of the line, starting-mover perspective (see module header);
   * `null` when the engine reported a mate instead.
   */
  readonly evalCp: number | null;
  /**
   * Mate evaluation, starting-mover perspective: positive = the starting mover
   * mates; `null` when the line does not carry a mate evaluation.
   */
  readonly evalMate: number | null;
  /** WDL of the line, starting-mover perspective; `null` when unavailable. */
  readonly wdl: Wdl | null;
  /** Principal variation as UCI tokens from `startingFen`. */
  readonly uci: readonly string[];
}

/** Pure, engine-free input to `verifyCandidate`. */
export interface TacticalVerificationInput {
  readonly candidate: RawCandidate;
  /** Unix epoch millis when the verification engine run completed. */
  readonly now: number;
  /** Search depth of the tactical-profile run. */
  readonly verificationDepth: number;
  readonly engine: {
    readonly engineName: string;
    readonly engineVersion: string;
    readonly engineBuild: string;
  };
  /** MultiPV lines from the tactical-profile run, rank-ordered best first. */
  readonly lines: readonly TacticalCandidateLine[];
}

export type VerifyResult =
  | { readonly ok: true; readonly candidate: VerifiedTacticalCandidate }
  | { readonly ok: false; readonly reason: VerificationRejectionReason };

/**
 * Result of walking one line's prefixes inside a ply window: the first
 * objective reached (with the prefix length) or why none was reached.
 */
export interface PrefixScanOutcome {
  /** First objective reached within the window, or `null`. */
  readonly objective: TacticalObjective | null;
  /** Prefix length (plies) at which `objective` was reached. */
  readonly plies: number | null;
  /** The window walk stopped on a stabilised two-ply pair (research §3). */
  readonly stoppedByStabilisation: boolean;
  /** The whole window (or the whole shorter line) was walked, no objective. */
  readonly endedByWindow: boolean;
}

function reject(reason: VerificationRejectionReason): VerifyResult {
  return { ok: false, reason };
}

/** Centipawn value of an end evaluation: a mate maps to ±10000 (cpValueOf). */
function numericCp(cp: number | null, mate: number | null): number | null {
  if (cp !== null) {
    return cp;
  }
  if (mate !== null) {
    return mate > 0 ? 10_000 : -10_000;
  }
  return null;
}

function walkPrefix(fen: string, uci: readonly string[], plies: number): LineWalk | null {
  const result = walkLine(fen, uci.slice(0, plies));
  return result.ok ? result.walk : null;
}

/**
 * Classify the objective reached by a walked prefix of an engine line, with
 * the prefix gates documented in the module header. `walk` must cover exactly
 * the walked plies; the end-state gates use `isLineEnd` to know whether the
 * walked prefix is the whole engine line.
 */
function classifyAtPrefix(
  walk: LineWalk,
  line: TacticalCandidateLine,
  startEvalCp: number | null,
  isLineEnd: boolean,
): TacticalObjective | null {
  const objective = classifyObjective({
    lineMaterialDelta: materialDelta(walk),
    startEvalCp,
    endEvalCp: line.evalCp,
    endEvalMate: line.evalMate,
    endWdl: line.wdl,
    wdlBefore: null,
  });
  if (objective === null) {
    return null;
  }
  if (objective === 'forcing_mate') {
    return isLineEnd && walk.final.termination === 'checkmate' ? objective : null;
  }
  if (objective === 'decisive_advantage' || objective === 'neutralizing_threat') {
    return isLineEnd ? objective : null;
  }
  return objective;
}

/**
 * Classify the objective reached at exactly `plies` of an engine line from
 * `fen`, or `null`. Pure and testable: the atomic prefix step the walker and
 * the beyond-window scans reuse. See the module header for the gates.
 */
export function objectiveAtPrefix(
  fen: string,
  line: TacticalCandidateLine,
  startEvalCp: number | null,
  plies: number,
): TacticalObjective | null {
  if (!Number.isInteger(plies) || plies < 1 || plies > line.uci.length) {
    return null;
  }
  const walk = walkPrefix(fen, line.uci, plies);
  if (!walk) {
    return null;
  }
  return classifyAtPrefix(walk, line, startEvalCp, plies === line.uci.length);
}

function lastPlyForcing(walk: LineWalk): boolean {
  const lastPly = walk.plies[walk.plies.length - 1];
  return lastPly !== undefined && (lastPly.isCheck || lastPly.isCapture);
}

/**
 * First prefix (1-based) whose cumulative material is `>= min` from that
 * prefix through the walked window — the point at which a material gain
 * becomes irreversible inside the walk (later recaptures never drop it back
 * below the threshold). Returns `null` when no such prefix exists.
 */
function earliestIrreversibleWin(materials: readonly number[], min: number): number | null {
  let runningMin = Number.POSITIVE_INFINITY;
  let earliest: number | null = null;
  for (let i = materials.length - 1; i >= 0; i -= 1) {
    runningMin = Math.min(runningMin, materials[i]!);
    if (runningMin >= min) {
      earliest = i + 1;
    }
  }
  return earliest;
}

/**
 * Walk an engine line's prefixes inside a ply window and return the objective
 * reached (research §3 step 2: stop on objective reached, window exceeded or a
 * stabilised two-ply pair). `maxPlies` bounds the window (default
 * `MAX_TACTIC_PLIES`). Prefixes of a line that fails to walk end the scan with
 * `endedByWindow` (no objective).
 *
 * Material objectives are evaluated for **retention**: a `winning_material`
 * prefix only counts when the gain is irreversible through the walk window
 * (the mover is still up `>= WINNING_MATERIAL_MIN_DELTA` at the stop point,
 * and the returned `plies` is the first prefix after which that never changes
 * — so an equal queen trade `Qxd8+ Kxd8` whose PV nets zero is never reported
 * as a one-ply material win). End-state objectives (`decisive_advantage`,
 * `neutralizing_threat`, board-checkmate `forcing_mate`) only count at the
 * whole engine line's end, where the single terminal evaluation is defined.
 */
export function prefixScan(
  fen: string,
  line: TacticalCandidateLine,
  startEvalCp: number | null,
  maxPlies: number = MAX_TACTIC_PLIES,
): PrefixScanOutcome {
  const limit = Math.min(maxPlies, line.uci.length);
  if (limit < 1) {
    return { objective: null, plies: null, stoppedByStabilisation: false, endedByWindow: true };
  }

  // Walk every prefix up to the window once and record per-prefix material and
  // forcingness so retention and the stop point are decided from stable data.
  const walks: LineWalk[] = [];
  const materials: number[] = [];
  for (let p = 1; p <= limit; p += 1) {
    const walk = walkPrefix(fen, line.uci, p);
    if (!walk) {
      return { objective: null, plies: null, stoppedByStabilisation: false, endedByWindow: true };
    }
    walks.push(walk);
    materials.push(materialDelta(walk));
  }

  // Earliest stabilised two-ply pair (research §3 step 2); otherwise the window
  // (line end or the ply cap) is the stop point.
  let stop = limit;
  let stoppedByStabilisation = false;
  for (let i = 1; i < limit; i += 1) {
    if (!lastPlyForcing(walks[i - 1]!) && !lastPlyForcing(walks[i]!)) {
      stop = i + 1;
      stoppedByStabilisation = true;
      break;
    }
  }

  // Retention-gated material win across the walked window (up to `stop`).
  const windowMaterials = materials.slice(0, stop);
  const irreversible = earliestIrreversibleWin(windowMaterials, WINNING_MATERIAL_MIN_DELTA);
  if (irreversible !== null) {
    return {
      objective: 'winning_material',
      plies: irreversible,
      stoppedByStabilisation: false,
      endedByWindow: false,
    };
  }

  // End-state objectives are only meaningful when the walked prefix is the whole
  // engine line (the single terminal evaluation is defined there).
  if (stop === line.uci.length) {
    const objective = classifyAtPrefix(walks[stop - 1]!, line, startEvalCp, true);
    if (objective !== null) {
      return { objective, plies: stop, stoppedByStabilisation: false, endedByWindow: false };
    }
  }

  if (stoppedByStabilisation) {
    return { objective: null, plies: null, stoppedByStabilisation: true, endedByWindow: false };
  }
  return { objective: null, plies: null, stoppedByStabilisation: false, endedByWindow: true };
}

/** First objective reached strictly beyond `afterPlies` (the >8-ply look). */
function firstObjectiveAfter(
  fen: string,
  line: TacticalCandidateLine,
  startEvalCp: number | null,
  afterPlies: number,
): TacticalObjective | null {
  for (let p = afterPlies + 1; p <= line.uci.length; p += 1) {
    const objective = objectiveAtPrefix(fen, line, startEvalCp, p);
    if (objective !== null) {
      return objective;
    }
  }
  return null;
}

/**
 * True when the line's end WDL (mover perspective, when present) contradicts
 * the classified objective (ADR-026 WDL guard). An absent WDL always passes;
 * `neutralizing_threat` is consistent by construction — its classification
 * already required the end state to be fine via the same end WDL.
 */
export function wdlContradictsObjective(objective: TacticalObjective, wdl: Wdl | null): boolean {
  if (wdl === null) {
    return false;
  }
  if (objective === 'winning_material' || objective === 'decisive_advantage') {
    return wdl.l >= WDL_WINNING_END_MAX_LOSS_PERMILLE;
  }
  if (objective === 'forcing_mate') {
    return wdl.w < WDL_MATE_END_MIN_WIN_PERMILLE;
  }
  return false;
}

/**
 * Verify a raw candidate against its tactical-profile MultiPV result.
 *
 * Order of guards (ADR-026): engine-line integrity (`no-lines`, `bad-line`,
 * `draw-line`), objective reachability (`no-objective` / `>8-plies`), the
 * ADR-025 difficulty floor (`difficulty-below-15`), the alternative-move
 * guard (`non-forcing-alternative-reaches-objective`) and WDL consistency
 * (`wdl-inconsistent`). Deterministic: the result is a pure function of the
 * input.
 */
export function verifyCandidate(input: TacticalVerificationInput): VerifyResult {
  const { candidate, lines, now, verificationDepth, engine } = input;
  const fen = candidate.startingFen;
  const startEvalCp = candidate.evalCpBefore;

  if (lines.length === 0) {
    return reject('no-lines');
  }
  const topLine = lines[0]!;
  const topWalkResult = walkLine(fen, topLine.uci);
  if (!topWalkResult.ok) {
    return reject('bad-line');
  }
  const topWalk = topWalkResult.walk;
  if (isTerminalDraw(topWalk.final.position)) {
    return reject('draw-line');
  }

  const scan = prefixScan(fen, topLine, startEvalCp);
  if (scan.objective === null) {
    if (scan.stoppedByStabilisation) {
      return reject('no-objective');
    }
    if (topLine.uci.length > MAX_TACTIC_PLIES) {
      const beyond = firstObjectiveAfter(fen, topLine, startEvalCp, MAX_TACTIC_PLIES);
      if (beyond !== null) {
        return reject('>8-plies');
      }
    }
    return reject('no-objective');
  }
  const objective = scan.objective;
  const solutionPlies = scan.plies;

  // Facts about the alternative lines (lines[1..]) needed by the difficulty
  // estimate (candidate count) and the alternative-move guard.
  const seenFirstMoves = new Set<string>();
  const topFirstMove = topLine.uci[0];
  if (topFirstMove !== undefined) {
    seenFirstMoves.add(topFirstMove);
  }
  const alternatives: Array<{
    readonly firstForcing: boolean;
    readonly scan: PrefixScanOutcome;
  }> = [];
  for (const line of lines.slice(1)) {
    const firstMove = line.uci[0];
    if (firstMove === undefined || seenFirstMoves.has(firstMove)) {
      continue;
    }
    seenFirstMoves.add(firstMove);
    const firstWalk = walkPrefix(fen, line.uci, 1);
    if (!firstWalk) {
      continue;
    }
    const firstPly = firstWalk.plies[0];
    const firstForcing = firstPly !== undefined && (firstPly.isCheck || firstPly.isCapture);
    alternatives.push({ firstForcing, scan: prefixScan(fen, line, startEvalCp) });
  }

  // Difficulty estimate (ADR-025 formula, ADR-026 ≥ 15 floor). `lineLength`,
  // `forcingness` and `material` describe the walked solution prefix; the
  // eval swing uses the line's single terminal evaluation (no per-prefix
  // evaluation exists) against the candidate's recorded start evaluation.
  const solutionWalkResult = walkLine(fen, topLine.uci.slice(0, solutionPlies!));
  if (!solutionWalkResult.ok) {
    return reject('bad-line');
  }
  const solutionWalk = solutionWalkResult.walk;
  const forcingnessPercent = forcingness(solutionWalk) * 100;
  const materialWon = Math.abs(materialDelta(solutionWalk));
  const endCp = numericCp(topLine.evalCp, topLine.evalMate);
  const evalSwing = Math.abs((endCp ?? 0) - (startEvalCp ?? 0));
  const solvingFirstMoves =
    1 + alternatives.filter((alternative) => alternative.scan.objective !== null).length;
  const difficulty = estimateDifficulty({
    lineLength: solutionPlies!,
    candidateFirstMoves: solvingFirstMoves,
    forcingness: forcingnessPercent,
    evalSwing,
    material: materialWon,
    depth: verificationDepth,
  });
  if (difficulty < VERIFICATION_MIN_DIFFICULTY) {
    return reject('difficulty-below-15');
  }

  // Alternative-move guard: a non-forcing first move that independently
  // reaches the same objective rejects (ADR-026 / research §1.4).
  for (const alternative of alternatives) {
    if (!alternative.firstForcing && alternative.scan.objective === objective) {
      return reject('non-forcing-alternative-reaches-objective');
    }
  }

  // WDL-consistency guard on the best line's end WDL.
  if (wdlContradictsObjective(objective, topLine.wdl)) {
    return reject('wdl-inconsistent');
  }

  const verified: VerifiedTacticalCandidate = {
    ...candidate,
    // Persist the line that was actually verified (the tactical-profile top
    // line walked to the objective) as the candidate's solution, so Feature
    // 011 / Game Review never consume a bulk-analysis PV that was not the one
    // verified. `candidateSolutionLength` prefixes the same line.
    bestMove: topLine.uci[0] ?? candidate.bestMove,
    bestPv: topLine.uci.slice(0, solutionPlies!),
    tacticalObjective: objective,
    candidateSolutionLength: solutionPlies!,
    verificationMetadata: {
      engineName: engine.engineName,
      engineVersion: engine.engineVersion,
      engineBuild: engine.engineBuild,
      analysisVersion: ANALYSIS_VERSION,
      verificationDepth,
      verificationTimestamp: now,
      wdlAfterBestLine: topLine.wdl,
    },
    detectionVersion: DETECTION_VERSION,
    verificationStatus: 'verified',
  };
  return { ok: true, candidate: verified };
}
