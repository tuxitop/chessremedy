import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
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

const DRAW_BRUSHES: DrawBrushes = { ...ANNOTATION_BRUSHES, ...ENGINE_ARROW_BRUSHES };

export interface ChessboardHandle {
  /** Clear all arrows drawn on the board (manual + automatic). */
  clearArrows(): void;
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
    const frozen = !p.interactive || !p.moving;
    api.set({
      fen: p.fen,
      turnColor: p.turnColor,
      check: p.check,
      orientation: p.orientation,
      coordinates: p.coordinates,
      viewOnly: !p.interactive,
      ...(p.interactive
        ? {
            movable: {
              free: false,
              color: 'both',
              showDests: p.showLegalMoves && !frozen,
              dests: frozen ? new Map() : p.dests,
            },
          }
        : {}),
      drawable: { enabled: p.drawable, brushes: DRAW_BRUSHES },
      animation: { enabled: p.animation },
      highlight: {
        lastMove: Boolean(p.lastMove),
        check: true,
        ...(p.customSquareClasses ? { custom: new Map(p.customSquareClasses.entries()) } : {}),
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
    const config: Config = {
      fen: p.fen,
      turnColor: p.turnColor,
      check: p.check,
      orientation: p.orientation,
      coordinates: p.coordinates,
      viewOnly: !p.interactive,
      movable: {
        free: false,
        color: 'both',
        showDests: p.showLegalMoves,
        dests: p.dests,
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
      },
      drawable: { enabled: p.drawable, brushes: DRAW_BRUSHES },
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
