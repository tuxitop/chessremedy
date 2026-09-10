import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type * as React from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape, DrawBrushes } from '@lichess-org/chessground/draw';
import type { Dests, Key, Piece, Color } from '@lichess-org/chessground/types';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles/board-brown.css';
import './styles/board-blue.css';
import './styles/board-green.css';
import './styles/board-purple.css';
import './styles/board-wood.css';
import './styles/piece-cburnett.css';
import './styles/piece-merida.css';
import './styles/piece-alpha.css';
import './styles/piece-chess7.css';
import './styles/piece-spatial.css';
import './styles/board-coordinate-contrast.css';
import { BoardContainer } from './BoardContainer';
import type { UseBoardSize } from './useBoardSize';
import {
  chessgroundDestsFromPosition,
  parseSquareKey,
  positionToFen,
  type ChessOpsPosition,
} from './chessopsAdapter';
import { ANNOTATION_COLORS } from './pgnAnnotations';
import { DEFAULT_BOARD_THEME, DEFAULT_PIECE_SET, type BoardTheme, type PieceSet } from './themes';

export type { BoardTheme, PieceSet };

/** Chessground brushes needed by PGN `%cal` / `%csl` annotation colors. */
const ANNOTATION_BRUSHES: DrawBrushes = {
  green: { key: 'g', color: ANNOTATION_COLORS.G.color, opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: ANNOTATION_COLORS.R.color, opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: ANNOTATION_COLORS.B.color, opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: ANNOTATION_COLORS.Y.color, opacity: 1, lineWidth: 10 },
  orange: { key: 'o', color: ANNOTATION_COLORS.O.color, opacity: 1, lineWidth: 10 },
  purple: { key: 'p', color: ANNOTATION_COLORS.P.color, opacity: 1, lineWidth: 10 },
};

/**
 * Brushes for engine-line arrows (Feature 006). The best line is drawn in a
 * warm colour so it is never confused with user-drawn (green) arrows; further
 * lines are greyed with decreasing opacity.
 */
const ENGINE_ARROW_BRUSHES = {
  best: { key: 'best', color: '#f0a000', opacity: 1, lineWidth: 10 },
  gray1: { key: 'gray1', color: '#9aa0a6', opacity: 0.85, lineWidth: 8 },
  gray2: { key: 'gray2', color: '#9aa0a6', opacity: 0.65, lineWidth: 8 },
  gray3: { key: 'gray3', color: '#9aa0a6', opacity: 0.45, lineWidth: 8 },
  gray4: { key: 'gray4', color: '#9aa0a6', opacity: 0.3, lineWidth: 8 },
  gray5: { key: 'gray5', color: '#9aa0a6', opacity: 0.2, lineWidth: 8 },
} as const;

const DRAW_BRUSHES: DrawBrushes = {
  ...ANNOTATION_BRUSHES,
  ...ENGINE_ARROW_BRUSHES,
  // Puzzle-hint brushes (Feature 012): the hint colour is the owner-specified
  // violet (~#8b5cf6), drawn as square highlights and the best-move arrow.
  violet: { key: 'violet', color: '#8b5cf6', opacity: 1, lineWidth: 10 },
};

export interface ChessboardHandle {
  /** Clear all arrows drawn on the board (manual + automatic). */
  clearArrows(): void;
  /**
   * Replace the board's user-drawn shapes (Chessground `drawable.shapes`) —
   * the arrows the user draws by hand and any the caller injects through this
   * handle. Injected shapes behave exactly like user-drawn ones: Chessground
   * keeps them across position/FEN re-renders and a board click erases them
   * (`eraseOnClick`), so callers must re-inject deliberately (e.g. on a fresh
   * puzzle or an explicit restart), never on every render.
   */
  setShapes(shapes: readonly DrawShape[]): void;
  /** Clear a pending promotion and restore the controlled position. */
  clearPendingPromotion(): void;
  /** (Re-)select a square on the board (used when promotion is cancelled). */
  selectSquare(key: Key | null): void;
}

export interface ChessboardProps {
  /** The chessops position to render. The wrapper re-renders on identity change. */
  position: ChessOpsPosition;
  /** Whether the user can move pieces. Defaults to `true`. */
  interactive?: boolean;
  /** Whether to show coordinates around the board. Defaults to `true`. */
  coordinates?: boolean;
  /** Whether to highlight legal destinations on piece selection. Defaults to `true`. */
  showLegalMoves?: boolean;
  /** Whether piece movement animations play. Defaults to `true`. */
  animation?: boolean;
  /** Whether arrow drawing is enabled. Defaults to `false`. */
  drawable?: boolean;
  /**
   * Whether a plain board click erases the user-drawn shapes (Chessground's
   * `drawable.eraseOnMovablePieceClick`). Omitted (default) leaves Chessground
   * to its own default so existing surfaces are untouched; `false` keeps
   * caller-injected shapes until the user really starts a piece move.
   */
  eraseOnClick?: boolean;
  /**
   * Fired whenever the USER draws or erases arrows on the board
   * (Chessground `drawable.onChange`): `shapes` is the board's current
   * user-drawn shape list (empty once they cleared everything). This is
   * NOT fired for programmatic `setShapes` calls nor for `api.set` wipes,
   * so callers can distinguish a deliberate erase from an automatic one.
   */
  onShapesChange?: (shapes: readonly DrawShape[]) => void;
  /**
   * When `false` piece input is frozen (no legal destinations). Used
   * while the promotion dialog is open so the board cannot change
   * underneath it.
   */
  moving?: boolean;
  /** `'white'` (bottom) or `'black'` (bottom). */
  orientation?: Color;
  /** Board theme. Defaults to `'brown'`. */
  boardTheme?: BoardTheme;
  /** Piece set. Defaults to `'cburnett'`. */
  pieceSet?: PieceSet;
  /** Optional last-move highlight (`[from, to]`). */
  lastMove?: readonly [Key, Key] | null;
  /** Optional square highlights (`Map<square, cssClass>`). */
  customSquareClasses?: ReadonlyMap<Key, string>;
  /** Shapes always drawn above the board (from `%cal`/`%csl` comments). */
  autoShapes?: readonly DrawShape[];
  /** Overlay content above the board (NAG / checkmate badges). */
  overlay?: React.ReactNode;
  /** Shared board-size API (from the owning surface). */
  boardSize?: UseBoardSize;
  /** Fired when the user plays a legal move. */
  onMove?: (from: Key, to: Key, capturedPiece?: Piece) => void;
  /**
   * Fired when a pawn reaches the back rank. The wrapper has reverted
   * the Chessground-internal move and frozen input; the caller must
   * play the move (with a promotion role) through its position model,
   * or cancel.
   */
  onPromotionRequired?: (pending: { from: Key; to: Key }) => void;
}

interface LiveProps {
  fen: string;
  turnColor: Color;
  check: Color | false;
  orientation: Color;
  coordinates: boolean;
  interactive: boolean;
  moving: boolean;
  showLegalMoves: boolean;
  animation: boolean;
  drawable: boolean;
  /** `undefined` (omitted) leaves Chessground's default erase behaviour. */
  eraseOnClick: boolean | undefined;
  /** User erase/draw listener (see `onShapesChange`), or `undefined`. */
  onShapesChange: ((shapes: readonly DrawShape[]) => void) | undefined;
  dests: Dests;
  lastMove: readonly [Key, Key] | null;
  customSquareClasses: ReadonlyMap<Key, string> | undefined;
  autoShapes: readonly DrawShape[] | undefined;
}

/**
 * True when the move is a pawn of the side to move landing on the opponent's
 * back rank. Only pawns can promote: a rook or other piece sliding to the
 * last rank must be treated as an ordinary move (see the `after` handler).
 */
export function isPromotionDestination(position: ChessOpsPosition, from: Key, dest: Key): boolean {
  const rank = dest[1];
  const onBackRank = position.turn === 'white' ? rank === '8' : rank === '1';
  if (!onBackRank) {
    return false;
  }
  const mover = position.board.get(parseSquareKey(from));
  return mover !== undefined && mover.role === 'pawn' && mover.color === position.turn;
}

/** Whether Chessground should bind board events at all (move + draw input). */
function eventsBound(p: Pick<LiveProps, 'interactive' | 'drawable'>): boolean {
  return p.interactive || p.drawable;
}

/**
 * The drawable sub-config Chessboard pushes: enable drawing with the app's
 * brushes and, when the caller supplied `eraseOnClick`, forward it to
 * Chessground's `drawable.eraseOnMovablePieceClick` (a plain board click then
 * clears the user-drawn shapes). Absent `eraseOnClick` the key is omitted so
 * Chessground's own default governs — existing surfaces are untouched. A
 * caller-supplied `onShapesChange` is forwarded to `drawable.onChange` so the
 * owner learns when the user draws/erases (programmatic `setShapes` and
 * `api.set` wipes never fire it).
 */
function drawableConfig(
  p: Pick<LiveProps, 'drawable' | 'eraseOnClick' | 'onShapesChange'>,
): NonNullable<Config['drawable']> {
  return {
    enabled: p.drawable,
    brushes: DRAW_BRUSHES,
    ...(p.eraseOnClick !== undefined ? { eraseOnMovablePieceClick: p.eraseOnClick } : {}),
    ...(p.onShapesChange !== undefined ? { onChange: p.onShapesChange } : {}),
  };
}

/**
 * Chessground interaction for one board state:
 *
 * - `interactive` boards move pieces as today;
 * - a board that is NOT interactive but IS drawable stays event-bound for
 *   inspection / free-drawing while every piece is frozen (no move, drag,
 *   select or premove) — the puzzle-view "drawable inspection" mode;
 * - a board that is neither interactive nor drawable is fully viewOnly.
 */
function interactionConfig(
  p: Pick<LiveProps, 'interactive' | 'drawable' | 'moving' | 'showLegalMoves' | 'dests'>,
): {
  readonly viewOnly: boolean;
  readonly movable: NonNullable<Config['movable']>;
} {
  if (!eventsBound(p)) {
    // Fully inert: Chessground binds nothing; the movable shape is irrelevant.
    return {
      viewOnly: true,
      movable: { free: false, color: 'both', showDests: false, dests: new Map() },
    };
  }
  if (!p.interactive) {
    // Warm inspection board (drawable on, pieces frozen).
    return {
      viewOnly: false,
      movable: { free: false, color: 'both', showDests: false, dests: new Map() },
    };
  }
  const frozen = !p.moving;
  return {
    viewOnly: false,
    movable: {
      free: false,
      color: 'both',
      showDests: p.showLegalMoves && !frozen,
      dests: frozen ? new Map() : p.dests,
    },
  };
}

/**
 * Explicit draggable / selectable / premove / predrop toggles for warm boards.
 * Chessground merges (never un-sets) omitted sub-objects, so a board that
 * passed through the warm-static state must be told to re-enable its piece
 * input when it returns to `interactive`.
 */
function pieceInputControls(p: Pick<LiveProps, 'interactive'>): {
  readonly draggable: { readonly enabled: boolean };
  readonly selectable: { readonly enabled: boolean };
  readonly premovable: { readonly enabled: boolean };
  readonly predroppable: { readonly enabled: boolean };
} {
  if (p.interactive) {
    return {
      draggable: { enabled: true },
      selectable: { enabled: true },
      premovable: { enabled: true },
      predroppable: { enabled: false },
    };
  }
  return {
    draggable: { enabled: false },
    selectable: { enabled: false },
    premovable: { enabled: false },
    predroppable: { enabled: false },
  };
}

/**
 * Chessboard wrapper around `@lichess-org/chessground`.
 *
 * Owns the Chessground lifecycle, the resize primitive (via
 * `BoardContainer`), and the chessops ↔ Chessground adapter. It is a
 * controlled component: the caller owns the position and hands it down.
 *
 * Promotion: when a pawn is dragged/clicked to the back rank the move is
 * reverted internally and input is frozen, then `onPromotionRequired` is
 * fired. The caller resolves by playing the real move (with a role)
 * through its own position model — the resulting `position` prop update
 * pushes the promoted board — or cancels via the handle.
 */
export const Chessboard = forwardRef<ChessboardHandle, ChessboardProps>(function Chessboard(
  {
    position,
    interactive = true,
    coordinates = true,
    showLegalMoves = true,
    animation = true,
    drawable = false,
    eraseOnClick,
    onShapesChange,
    moving = true,
    orientation = 'white',
    boardTheme = DEFAULT_BOARD_THEME,
    pieceSet = DEFAULT_PIECE_SET,
    lastMove,
    customSquareClasses,
    autoShapes,
    overlay,
    boardSize,
    onMove,
    onPromotionRequired,
  },
  ref,
): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const pendingPromotionRef = useRef<{ from: Key; to: Key } | null>(null);
  const onShapesChangeRef = useRef(onShapesChange);
  onShapesChangeRef.current = onShapesChange;
  const notifyShapesChange = useCallback((shapes: readonly DrawShape[]): void => {
    onShapesChangeRef.current?.(shapes);
  }, []);
  const livePropsRef = useRef<LiveProps>({
    fen: '',
    turnColor: 'white',
    check: false,
    orientation,
    coordinates,
    interactive,
    moving,
    showLegalMoves,
    animation,
    drawable,
    eraseOnClick,
    onShapesChange: onShapesChange ? notifyShapesChange : undefined,
    dests: new Map(),
    lastMove: lastMove ?? null,
    customSquareClasses,
    autoShapes,
  });
  const positionRef = useRef(position);
  positionRef.current = position;

  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onPromotionRef = useRef(onPromotionRequired);
  onPromotionRef.current = onPromotionRequired;

  livePropsRef.current = {
    fen: positionToFen(position),
    turnColor: position.turn === 'white' ? 'white' : 'black',
    check: position.isCheck() ? (position.turn === 'white' ? 'white' : 'black') : false,
    orientation,
    coordinates,
    interactive,
    moving,
    showLegalMoves,
    animation,
    drawable,
    eraseOnClick,
    onShapesChange: onShapesChange ? notifyShapesChange : undefined,
    dests: chessgroundDestsFromPosition(position),
    lastMove: lastMove ?? null,
    customSquareClasses,
    autoShapes,
  };

  // Push the current props into Chessground.
  const applyState = (): void => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    // While a promotion waits for a role, Chessground keeps the position
    // it produced internally (the pawn sits on the last rank). Do not
    // overwrite it until the caller resolves or cancels.
    if (pendingPromotionRef.current) {
      return;
    }
    const p = livePropsRef.current;
    const interaction = interactionConfig(p);
    api.set({
      fen: p.fen,
      turnColor: p.turnColor,
      check: p.check,
      orientation: p.orientation,
      coordinates: p.coordinates,
      viewOnly: interaction.viewOnly,
      movable: interaction.movable,
      ...(interaction.viewOnly ? {} : pieceInputControls(p)),
      drawable: drawableConfig(p),
      animation: { enabled: p.animation },
      highlight: {
        lastMove: Boolean(p.lastMove),
        check: true,
        // Always send the custom map (empty when absent) so Chessground's
        // deep merge clears previously highlighted squares instead of
        // leaving stale classes on the board.
        custom: new Map(p.customSquareClasses?.entries() ?? []),
      },
      ...(p.lastMove ? { lastMove: [...p.lastMove] as Key[] } : {}),
    });
    api.setAutoShapes(p.autoShapes ? [...p.autoShapes] : []);
  };

  // Freeze the board in place (dests removed, no fen change) while a
  // promotion is waiting for a role — the pawn stays on the last rank.
  const freezeForPromotion = (): void => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    api.set({
      movable: { free: false, color: 'both', showDests: false, dests: new Map() },
      drawable: { enabled: false },
      premovable: { enabled: false },
      predroppable: { enabled: false },
    });
  };

  const applyStateRef = useRef(applyState);
  applyStateRef.current = applyState;

  // Mount Chessground once; updates flow through `applyState`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const p = livePropsRef.current;
    const interaction = interactionConfig(p);
    const config: Config = {
      fen: p.fen,
      turnColor: p.turnColor,
      check: p.check,
      orientation: p.orientation,
      coordinates: p.coordinates,
      viewOnly: interaction.viewOnly,
      movable: {
        ...interaction.movable,
        // Bind the move handler whenever the board is event-bound at mount
        // (interactive OR drawable). Chessground reads `state.movable.events`
        // live on every move but only installs it from the mount config and
        // preserves it across later `api.set` merges — so a board that mounts
        // non-interactive but drawable (e.g. a solve board still loading its
        // async game prefix) must still receive the handler here or moves
        // later become legal yet never reach `onMove`. Warm/static boards can
        // never fire it: pieces are frozen (`dests` empty, input disabled).
        ...(eventsBound(p)
          ? {
              events: {
                after: (orig: Key, dest: Key) => {
                  const pos = positionRef.current;
                  if (isPromotionDestination(pos, orig, dest)) {
                    if (pendingPromotionRef.current) {
                      return;
                    }
                    pendingPromotionRef.current = { from: orig, to: dest };
                    freezeForPromotion();
                    onPromotionRef.current?.({ from: orig, to: dest });
                    return;
                  }
                  onMoveRef.current?.(orig, dest);
                },
              },
            }
          : {}),
      },
      ...(interaction.viewOnly ? {} : pieceInputControls(p)),
      drawable: drawableConfig(p),
      animation: { enabled: p.animation },
      highlight: { lastMove: Boolean(p.lastMove), check: true },
    };
    const api = Chessground(host, config);
    apiRef.current = api;
    applyStateRef.current();
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, []);

  // Keep Chessground in sync with the latest props.
  useEffect(() => {
    applyStateRef.current();
  }, [
    position,
    interactive,
    coordinates,
    showLegalMoves,
    animation,
    drawable,
    eraseOnClick,
    moving,
    orientation,
    lastMove,
    customSquareClasses,
    autoShapes,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      clearArrows: () => {
        const api = apiRef.current;
        if (!api) {
          return;
        }
        api.setShapes([]);
        api.setAutoShapes([]);
      },
      setShapes: (shapes) => {
        const api = apiRef.current;
        if (!api) {
          return;
        }
        api.setShapes(shapes ? [...shapes] : []);
      },
      clearPendingPromotion: () => {
        pendingPromotionRef.current = null;
        applyStateRef.current();
      },
      selectSquare: (key) => {
        apiRef.current?.selectSquare(key);
      },
    }),
    [],
  );

  const wrapperClass = `cg-wrap board-${boardTheme} piece-${pieceSet}`;

  return (
    <BoardContainer
      ariaLabel="Chessboard"
      {...(overlay !== undefined ? { overlay } : {})}
      {...(boardSize !== undefined ? { boardSize } : {})}
    >
      <div
        ref={hostRef}
        className={wrapperClass}
        data-testid="chessground-host"
        data-board-theme={boardTheme}
        data-piece-set={pieceSet}
        data-orientation={orientation}
        style={{ width: '100%', height: '100%' }}
      />
    </BoardContainer>
  );
});
