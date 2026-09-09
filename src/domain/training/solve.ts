/**
 * Feature 012 — presentation solving engine (domain, pure).
 *
 * Deterministic, engine/network/IndexedDB-free solving over an immutable
 * Feature-011 `PuzzleRow`. Chess rules/state live on `chessops` (ADR-028); the
 * engine never runs and no puzzle is ever re-derived here — this module only
 * *presents* a stored row.
 *
 * A presentation is a pure **token trace**: the immutable state holds the
 * played line (the user's accepted moves plus the auto-played opponent replies
 * of the chosen stored branch) and every position is replayed from
 * `startingFen` on demand. Because the user is always the mover at
 * `startingFen`, the tokens of the chosen branch alternate user/opponent
 * starting with the user, so the decision point and the next expected user
 * token are fully determined by the line prefix length.
 *
 * Answer evaluation is per origin: a tactical row accepts
 * `{ bestMove } ∪ acceptedFirstMoves` at the first decision point and then the
 * stored branch line (`bestPv`) move-for-move; a blunder row accepts exactly
 * its single `bestMove` and nothing beyond it (Feature-011 contract). All UCI
 * comparison is canonical — promotion piece included, castling compared by the
 * king's two-square UCI, en-passant by its capture token — so an alternate
 * (e.g. king-to-rook-square) spelling of the same legal castling is accepted.
 * Accepted alternatives have **no stored continuation** in V1 (plan R-1), so
 * they are terminal: playing one solves the puzzle on that first move.
 */

import { castlingSide } from 'chessops/chess';
import { isNormal, type NormalMove } from 'chessops/types';
import { kingCastlesTo, makeSquare, makeUci, parseUci } from 'chessops/util';
import { parsePositionFen, type Position } from '@/domain/chess/position';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { HintLevel } from './types';

/**
 * Immutable presentation state over one puzzle row.
 *
 * The state is a pure token trace plus the presentation's counter/hint memory;
 * positions are never stored (they are replayed from `startingFen` on demand),
 * which keeps the state immutable and shallow. The played `line` holds, in
 * play order, every accepted user move and every auto-played opponent reply
 * (including a trailing opponent token appended for display when the stored
 * line ends on one — line parity). Wrong moves never enter the line.
 *
 * Invariants: `line` is always a strict prefix of the selected branch when the
 * presentation is mid-branch, and a stable (move-entry) state always has an
 * even `line` length unless the presentation is solved.
 */
export interface PresentationState {
  /** The immutable puzzle row being presented (never modified). */
  readonly row: PuzzleRow;
  /** Presentation start, Unix epoch millis (wall clock; restart keeps it). */
  readonly startedAt: number;
  /** Played line as UCI tokens from `startingFen` (view/transport source). */
  readonly line: readonly string[];
  /** Wrong moves tried, in attempt order (post-solve "you tried X"). */
  readonly wrongMovesTried: readonly string[];
  /** Wrong-move count — the domain's "number of attempts" (no V1 limit). */
  readonly wrongMoveCount: number;
  /** Hint presses this presentation (never reset by restart). */
  readonly hintCount: number;
  /** Highest hint level reached this presentation (never reset by restart). */
  readonly highestHintLevel: HintLevel | null;
  /**
   * Hint levels whose content is currently revealed. Cleared by restart (the
   * reveal sequence then restarts from the configured first level); only the
   * counters above persist across a restart.
   */
  readonly revealedHintLevels: readonly HintLevel[];
}

/** Result of `beginPresentation`. */
export type PresentationBeginResult =
  | { readonly ok: true; readonly state: PresentationState }
  | { readonly ok: false; readonly message: string };

/**
 * Result of evaluating one move at the current decision point.
 *
 * - `accepted` — the move is correct: it was appended (with the auto-played
 *   opponent reply, if the chosen branch has one) and `solved` tells whether
 *   the presentation is complete;
 * - `wrong` — a legal move outside the accepted set: it never advances the
 *   line, the board returns to the decision point, and `wrongMoveCount` is
 *   incremented (the move is remembered for the post-solve step);
 * - `illegal` — not a legal move at the decision point (or the presentation is
 *   already solved): rejected without counting. The board never offers illegal
 *   moves; a keyboard/text path rejects them before the domain (R-4); this is
 *   the domain's defensive guard.
 */
export type PresentationMoveResult =
  | { readonly kind: 'accepted'; readonly solved: boolean; readonly state: PresentationState }
  | { readonly kind: 'wrong'; readonly state: PresentationState }
  | { readonly kind: 'illegal'; readonly message: string; readonly state: PresentationState };

/** Result of `positionAtPly`. */
export type PresentationPositionResult =
  | { readonly ok: true; readonly position: Position }
  | { readonly ok: false; readonly message: string };

type ReplayResult =
  | { readonly ok: true; readonly position: Position }
  | { readonly ok: false; readonly message: string };

/**
 * Accepted first-move set of a row, per origin:
 *
 * - blunder row: exactly `{ bestMove }` (Feature-012 must accept that single
 *   move and nothing beyond the one ply);
 * - tactical row: `{ bestMove } ∪ acceptedFirstMoves` — an empty or absent
 *   `acceptedFirstMoves` means `{ bestMove }`.
 */
export function acceptedMovesOf(row: PuzzleRow): ReadonlySet<string> {
  if (row.origin === 'blunder') {
    return new Set([row.bestMove]);
  }
  const accepted = new Set<string>([row.bestMove]);
  for (const move of row.acceptedFirstMoves ?? []) {
    accepted.add(move);
  }
  return accepted;
}

/**
 * Begin a presentation: validate the stored row and build the initial state
 * (empty played line, counters zero, clock at `now`).
 *
 * A row whose `startingFen` does not parse, or whose stored solution (`bestPv`
 * / `bestMove` / `acceptedFirstMoves`) does not replay legally from it, is a
 * pipeline defect (mirroring Feature-011's assembly contract): the
 * presentation **fails to load** with a typed error and the session never
 * crashes (spec Error cases). Validating the whole stored line up front also
 * guarantees the auto-played opponent replies can never fail mid-branch.
 */
export function beginPresentation(row: PuzzleRow, now: number): PresentationBeginResult {
  const problem = validatePresentation(row);
  if (problem !== null) {
    return { ok: false, message: problem };
  }
  return {
    ok: true,
    state: {
      row,
      startedAt: now,
      line: [],
      wrongMovesTried: [],
      wrongMoveCount: 0,
      hintCount: 0,
      highestHintLevel: null,
      revealedHintLevels: [],
    },
  };
}

/**
 * True when the presentation is solved: no further user move is expected.
 *
 * A blunder row is solved once its single `bestMove` is played; a tactical row
 * once every user token of the chosen branch (`bestPv`, or the terminal
 * accepted alternative) has been played. A trailing opponent token may already
 * have been auto-played for display (line parity).
 */
export function presentationSolved(state: PresentationState): boolean {
  const { line } = state;
  if (line.length === 0) {
    return false;
  }
  if (state.row.origin === 'blunder') {
    return true;
  }
  if (line[0] !== state.row.bestMove) {
    // An accepted first move without a stored continuation is terminal.
    return true;
  }
  const branch = state.row.bestPv;
  const usersTotal = Math.ceil(branch.length / 2);
  const usersPlayed = Math.floor((line.length + 1) / 2);
  return usersPlayed >= usersTotal;
}

/**
 * Evaluate one canonical-UCI move at the current decision point.
 *
 * The caller pre-checks legality (the board constrains to legal moves; the
 * text path validates against the live position with `chessops/san`), but the
 * domain also guards: a malformed, non-normal, or illegal token is rejected as
 * `illegal` without being counted. A legal move is compared canonically
 * against the decision point's accepted set:
 *
 * - first decision point — the per-origin accepted set; an accepted `bestMove`
 *   advances along `bestPv` (auto-playing the opponent reply), an accepted
 *   alternative with no stored continuation is terminal (solved immediately),
 *   and a blunder row is solved by its single `bestMove`;
 * - later decision points — the chosen branch's next user move exactly;
 *   anything else legal is a wrong branch.
 *
 * The presentation is solved when the branch's user tokens are exhausted; any
 * trailing opponent token is auto-played for display only.
 */
export function applyMove(state: PresentationState, uci: string): PresentationMoveResult {
  if (presentationSolved(state)) {
    return {
      kind: 'illegal',
      message: 'The presentation is already solved; no further move is accepted.',
      state,
    };
  }

  const decision = replayLine(state.row.startingFen, state.line);
  if (!decision.ok) {
    return { kind: 'illegal', message: decision.message, state };
  }
  const position = decision.position;

  const parsed = parseUci(uci);
  if (!parsed || !isNormal(parsed)) {
    return {
      kind: 'illegal',
      message: `"${uci}" is not a canonical UCI move.`,
      state,
    };
  }
  if (!position.isLegal(parsed)) {
    return {
      kind: 'illegal',
      message: `"${uci}" is not a legal move at the decision point.`,
      state,
    };
  }
  const userToken = canonicalUci(position, parsed);

  let accepted = false;
  if (state.line.length === 0) {
    accepted = acceptedMovesOf(state.row).has(userToken);
  } else {
    const branch = state.row.bestPv;
    const nextToken = branch[state.line.length];
    if (nextToken === undefined || state.line[0] !== state.row.bestMove) {
      // Unreachable on well-formed states (solved states are guarded above).
      return { kind: 'illegal', message: 'The presentation state is inconsistent.', state };
    }
    const parsedExpected = parseUci(nextToken);
    if (!parsedExpected || !isNormal(parsedExpected)) {
      return {
        kind: 'illegal',
        message: `The stored branch token "${nextToken}" is invalid.`,
        state,
      };
    }
    accepted = userToken === canonicalUci(position, parsedExpected);
  }

  if (!accepted) {
    return {
      kind: 'wrong',
      state: {
        ...state,
        wrongMoveCount: state.wrongMoveCount + 1,
        wrongMovesTried: [...state.wrongMovesTried, userToken],
      },
    };
  }

  const newLine = advanceLine(state, userToken);
  const nextState: PresentationState = { ...state, line: newLine };
  return { kind: 'accepted', solved: presentationSolved(nextState), state: nextState };
}

/**
 * Restart the presentation: clear the played line and any revealed hint
 * content and return the board to `startingFen`.
 *
 * Restart does **not** end the presentation, does not reset the wrong-move
 * count, the hint counters or the solving clock, and does not create an
 * attempt (spec "restart"); the wrong-moves-tried memory is kept too (the
 * wrong-move counter it backs is not reset).
 */
export function restartPresentation(state: PresentationState): PresentationState {
  return {
    ...state,
    line: [],
    revealedHintLevels: [],
  };
}

/**
 * The presentation's played line (view/transport source), UCI tokens in play
 * order — the user's accepted moves plus auto-played opponent replies.
 */
export function playedLine(state: PresentationState): readonly string[] {
  return state.line;
}

/**
 * Position after the first `ply` tokens of the played line (`ply = 0` is the
 * `startingFen` position; `ply = line.length` is the current position). View
 * only: transport over the presentation's move line; move entry only happens
 * at the decision point (the end of the line). Returns an error result for an
 * out-of-range ply.
 */
export function positionAtPly(state: PresentationState, ply: number): PresentationPositionResult {
  if (!Number.isInteger(ply) || ply < 0 || ply > state.line.length) {
    return {
      ok: false,
      message: `Ply ${ply} is out of range for a ${state.line.length}-token played line.`,
    };
  }
  return replayLine(state.row.startingFen, state.line, ply);
}

// --- internal helpers --------------------------------------------------------

function validatePresentation(row: PuzzleRow): string | null {
  const fen = parsePositionFen(row.startingFen);
  if (!fen.ok) {
    return `Cannot present puzzle ${row.sourceGameId}:${row.sourcePly}: ${fen.message}`;
  }
  const start = fen.position;

  const bestMove = parseUci(row.bestMove);
  if (!bestMove || !isNormal(bestMove)) {
    return `Puzzle ${row.sourceGameId}:${row.sourcePly} stores an invalid bestMove "${row.bestMove}".`;
  }
  if (!start.isLegal(bestMove)) {
    return (
      `Puzzle ${row.sourceGameId}:${row.sourcePly} stores bestMove "${row.bestMove}" that is ` +
      `not legal from its startingFen.`
    );
  }

  if (row.origin === 'blunder') {
    if (row.bestPv.length !== 1 || row.bestPv[0] !== row.bestMove) {
      return (
        `Puzzle ${row.sourceGameId}:${row.sourcePly} is a blunder row whose bestPv is not the ` +
        `singleton [bestMove].`
      );
    }
    return null;
  }

  if (row.bestPv.length === 0) {
    return `Puzzle ${row.sourceGameId}:${row.sourcePly} stores an empty solution line.`;
  }
  if (row.bestPv[0] !== row.bestMove) {
    return (
      `Puzzle ${row.sourceGameId}:${row.sourcePly} stores a bestPv that does not start with ` +
      `bestMove "${row.bestMove}".`
    );
  }
  const walked = replayLine(row.startingFen, row.bestPv);
  if (!walked.ok) {
    return (
      `Puzzle ${row.sourceGameId}:${row.sourcePly} stores a solution that does not replay: ` +
      walked.message
    );
  }
  for (const alternative of row.acceptedFirstMoves ?? []) {
    const move = parseUci(alternative);
    if (!move || !isNormal(move) || !start.isLegal(move)) {
      return (
        `Puzzle ${row.sourceGameId}:${row.sourcePly} stores accepted first move ` +
        `"${alternative}" that is not legal from its startingFen.`
      );
    }
  }
  return null;
}

function advanceLine(state: PresentationState, userToken: string): readonly string[] {
  const { line, row } = state;
  if (row.origin === 'blunder') {
    return [userToken];
  }
  if (line.length === 0) {
    if (userToken !== row.bestMove) {
      // Accepted alternative with no stored continuation: terminal.
      return [userToken];
    }
    const branch = row.bestPv;
    const reply = branch.length > 1 ? branch[1] : undefined;
    return reply === undefined ? [userToken] : [userToken, reply];
  }
  const branch = row.bestPv;
  const nextLine = [...line, userToken];
  const replyIndex = line.length + 1;
  if (replyIndex < branch.length) {
    const reply = branch[replyIndex];
    if (reply !== undefined) {
      nextLine.push(reply);
    }
  }
  return nextLine;
}

/**
 * Canonical UCI of a normal move at a position. Castling is normalized to the
 * king's two-square token (`e1g1`/`e1c1`) whatever spelling was given (chessops
 * also accepts the king-to-rook-square `e1h1` form); promotion keeps its piece
 * letter; en-passant compares by its capture token.
 */
function canonicalUci(position: Position, move: NormalMove): string {
  const side = castlingSide(position, move);
  if (side) {
    return `${makeSquare(move.from)}${makeSquare(kingCastlesTo(position.turn, side))}`;
  }
  return makeUci(move);
}

function replayLine(fen: string, tokens: readonly string[], upToPly?: number): ReplayResult {
  const parsed = parsePositionFen(fen);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const position = parsed.position;
  const end = upToPly === undefined ? tokens.length : upToPly;
  for (let index = 0; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      return { ok: false, message: 'The played line is truncated.' };
    }
    const move = parseUci(token);
    if (!move || !isNormal(move)) {
      return { ok: false, message: `The played token "${token}" is not a canonical UCI move.` };
    }
    if (!position.isLegal(move)) {
      return { ok: false, message: `The played token "${token}" is not legal here.` };
    }
    position.play(move);
  }
  return { ok: true, position };
}
