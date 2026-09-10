/**
 * Feature 012 — hints (domain, pure).
 *
 * The four progressive hint levels of PRODUCT §10 (the authoritative
 * definition); each level reveals exactly its level's information and nothing
 * more, and hints never reveal anything beyond the **first** solution move:
 * once that move is solved, further hints are unavailable (the reveal helper
 * gates on the played line). Using a hint never fails the puzzle and never
 * increments the wrong-move count — it only advances the hint counters.
 *
 * Level content:
 *
 * 1. Relevant piece — the piece type that initiates the solution;
 * 2. Piece highlight — that piece's starting square;
 * 3. Destination — the destination square of the first solution move;
 * 4. Move — the full first solution move as SAN.
 *
 * Level availability/threshold is host-supplied per set (`SolveHintConfig`);
 * the domain keeps it a pure parameter. `nextHintLevel` advances one level per
 * press from the configured first level, skipping disabled levels, capped at
 * level 4. Hint content is never persisted on a puzzle or attempt (only the
 * hint count and highest level reached are recorded).
 *
 * Product default (owner UX ruling): the reveal sequence starts at level 2 so
 * the very first Hint press produces a visible square highlight — level 1
 * (piece type, text only) is enabled for no set in V1.
 */

import { makeSan } from 'chessops/san';
import { isNormal, type Role } from 'chessops/types';
import { makeSquare, parseUci } from 'chessops/util';
import type { Position } from '@/domain/chess/position';
import type { PuzzleRow } from '@/domain/puzzle/types';
import type { PresentationState } from './solve';
import type { HintLevel, SolveHintConfig } from './types';

/**
 * Default per-set hint configuration (owner UX ruling): level 1 is text-only
 * with no board visual, so the first press starts at level 2 — the piece's
 * starting-square highlight — and ascends through 3 (destination) to 4 (the
 * full SAN move).
 */
export const DEFAULT_SOLVE_HINT_CONFIG: SolveHintConfig = {
  enabledLevels: [2, 3, 4],
  firstHintLevel: 2,
};

const ROLE_WORD: Readonly<Record<Role, string>> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};

/**
 * The hint content revealed at one level: announcement text plus the squares
 * (in the board's own coordinate names, e.g. `e4`) the UI should highlight.
 * `squares` is empty when the level reveals no square (level 1 reveals only
 * the piece type).
 */
export interface HintContent {
  readonly level: HintLevel;
  readonly text: string;
  readonly squares: readonly string[];
}

/** Result of `hintContent`. */
export type HintContentResult =
  | { readonly ok: true; readonly content: HintContent }
  | { readonly ok: false; readonly message: string };

/** Result of `revealNextHint`. */
export type HintRevealResult =
  | { readonly ok: true; readonly state: PresentationState; readonly level: HintLevel }
  | {
      readonly ok: false;
      readonly state: PresentationState;
      readonly reason: 'first-move-solved' | 'no-further-level';
    };

/**
 * The next hint level a press should reveal, or `null` when none remains.
 *
 * `reached` is the highest level already revealed in the current presentation
 * run (`null` before the first press); the next level is the smallest enabled
 * level at or above the configured `firstHintLevel` that is greater than
 * `reached`, capped at level 4. Disabled levels and levels below the threshold
 * are skipped; `null` when no further enabled level exists.
 */
export function nextHintLevel(
  reached: HintLevel | null,
  config: SolveHintConfig,
): HintLevel | null {
  const floor = Math.max(config.firstHintLevel, (reached ?? 0) + 1);
  for (let level = floor as HintLevel; level <= 4; level += 1) {
    const candidate = level as HintLevel;
    if (config.enabledLevels.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * The exact PRODUCT §10 content of one hint level for the row's first
 * solution move, rendered against the decision point position.
 *
 * The position is the board state the hint refers to — in solving, always the
 * puzzle start position (hints are gated off once the first move is solved).
 * Returns an error result when the row's `bestMove` cannot be replayed at that
 * position (a caller/state defect, never thrown).
 */
export function hintContent(
  level: HintLevel,
  row: PuzzleRow,
  position: Position,
): HintContentResult {
  const move = parseUci(row.bestMove);
  if (!move || !isNormal(move)) {
    return { ok: false, message: `Row stores an invalid bestMove "${row.bestMove}".` };
  }
  if (!position.isLegal(move)) {
    return { ok: false, message: `bestMove "${row.bestMove}" is not legal at the hint position.` };
  }
  const piece = position.board.get(move.from);
  if (!piece) {
    return { ok: false, message: 'The bestMove from-square holds no piece at the hint position.' };
  }

  if (level === 1) {
    return {
      ok: true,
      content: {
        level,
        text: `Relevant piece: ${ROLE_WORD[piece.role]}`,
        squares: [],
      },
    };
  }

  const from = makeSquare(move.from);
  const to = makeSquare(move.to);
  if (level === 2) {
    return { ok: true, content: { level, text: `The piece is on ${from}`, squares: [from] } };
  }
  if (level === 3) {
    return { ok: true, content: { level, text: `Move it to ${to}`, squares: [to] } };
  }
  return {
    ok: true,
    content: { level, text: makeSan(position, move), squares: [from, to] },
  };
}

/**
 * Apply one hint press to a presentation: advance one level and record it.
 *
 * Gated off once the first solution move has been solved (`line` non-empty) —
 * hints cover the first move only. When a further level exists, the press
 * increments `hintCount`, raises `highestHintLevel`, and appends the level to
 * the currently revealed content (which `restartPresentation` clears).
 */
export function revealNextHint(
  state: PresentationState,
  config: SolveHintConfig,
): HintRevealResult {
  if (state.line.length > 0) {
    return { ok: false, state, reason: 'first-move-solved' };
  }
  const revealed = state.revealedHintLevels;
  const reached: HintLevel | null = revealed.length > 0 ? revealed[revealed.length - 1]! : null;
  const level = nextHintLevel(reached, config);
  if (level === null) {
    return { ok: false, state, reason: 'no-further-level' };
  }
  const nextHighest: HintLevel =
    state.highestHintLevel === null || level > state.highestHintLevel
      ? level
      : state.highestHintLevel;
  return {
    ok: true,
    state: {
      ...state,
      hintCount: state.hintCount + 1,
      highestHintLevel: nextHighest,
      revealedHintLevels: [...revealed, level],
    },
    level,
  };
}
