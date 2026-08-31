import { useEffect, useMemo, useRef } from 'react';
import type * as React from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Dests, Key, Piece, Color, SquareClasses } from '@lichess-org/chessground/types';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import { BoardContainer } from './BoardContainer';
import {
  chessgroundDestsFromPosition,
  positionToFen,
  type ChessOpsPosition,
} from './chessopsAdapter';

export type BoardTheme = 'brown' | 'blue' | 'green' | 'purple' | 'wood';

export const SUPPORTED_BOARD_THEMES: readonly BoardTheme[] = [
  'brown',
  'blue',
  'green',
  'purple',
  'wood',
];

export interface ChessboardProps {
  /** The chessops position to render. The wrapper re-renders on identity change. */
  position: ChessOpsPosition;
  /** Whether the user can move pieces. Defaults to `true`. */
  interactive?: boolean;
  /** Whether to show coordinates around the board. Defaults to `true`. */
  coordinates?: boolean;
  /** Whether to highlight legal destinations on piece selection. Defaults to `true`. */
  showDests?: boolean;
  /** Whether piece movement animations play. Defaults to `true`. */
  animation?: boolean;
  /** Whether arrow drawing is enabled. Defaults to `false`. */
  drawable?: boolean;
  /** `'white'` (bottom) or `'black'` (bottom). */
  orientation?: Color;
  /** Board theme. Defaults to `'brown'`. */
  theme?: BoardTheme;
  /** Optional last-move highlight (`[from, to]`). */
  lastMove?: readonly [Key, Key];
  /** Optional square highlights (`Map<square, cssClass>`). */
  customSquareClasses?: ReadonlyMap<Key, string>;
  /** Fired when the user plays a legal move. */
  onMove?: (from: Key, to: Key, capturedPiece?: Piece) => void;
  /** Fired when the user changes the orientation. */
  onOrientationChange?: (orientation: Color) => void;
}

/**
 * Chessboard wrapper around `@lichess-org/chessground`.
 *
 * Owns the Chessground lifecycle (mount into a host `<div>`, destroy
 * on unmount), the resize primitive (via `BoardContainer`), and the
 * chessops ↔ Chessground adapter.
 */
export function Chessboard({
  position,
  interactive = true,
  coordinates = true,
  showDests = true,
  animation = true,
  drawable = false,
  orientation = 'white',
  theme = 'brown',
  lastMove,
  customSquareClasses,
  onMove,
  onOrientationChange,
}: ChessboardProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const onMoveRef = useRef<typeof onMove>(onMove);
  const onOrientationRef = useRef<typeof onOrientationChange>(onOrientationChange);

  // Capture latest callbacks in refs so the Chessground `events` block
  // doesn't need to be rebuilt every render.
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);
  useEffect(() => {
    onOrientationRef.current = onOrientationChange;
  }, [onOrientationChange]);

  const fen = useMemo(() => positionToFen(position), [position]);
  const dests = useMemo<Dests>(() => chessgroundDestsFromPosition(position), [position]);

  const customSquareClassesMap = useMemo<SquareClasses | undefined>(() => {
    if (!customSquareClasses) {
      return undefined;
    }
    return new Map(customSquareClasses.entries());
  }, [customSquareClasses]);

  // Mount Chessground once on mount; destroy on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const initialConfig: Config = {
      fen,
      orientation,
      coordinates,
      viewOnly: !interactive,
      ...(interactive
        ? {
            movable: {
              free: false,
              color: 'both',
              showDests,
              dests,
              events: {
                after: (orig: Key, dest: Key) => {
                  onMoveRef.current?.(orig, dest);
                },
              },
            },
          }
        : {}),
      drawable: {
        enabled: drawable,
      },
      animation: {
        enabled: animation,
      },
      highlight: {
        lastMove: Boolean(lastMove),
        ...(customSquareClassesMap ? { custom: customSquareClassesMap } : {}),
      },
      ...(lastMove ? { lastMove: [...lastMove] as Key[] } : {}),
      events: {
        change: () => {
          const api = apiRef.current;
          if (!api) {
            return;
          }
          onOrientationRef.current?.(api.state.orientation);
        },
      },
    };
    const api = Chessground(host, initialConfig);
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
    // We deliberately exclude the position/options here: Chessground is
    // updated imperatively via `api.set(...)` below. Re-mounting on
    // every prop change would destroy piece state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push prop updates into Chessground.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    api.set({
      fen,
      orientation,
      coordinates,
      viewOnly: !interactive,
      ...(interactive
        ? {
            movable: {
              free: false,
              color: 'both',
              showDests,
              dests,
            },
          }
        : {}),
      drawable: {
        enabled: drawable,
      },
      animation: {
        enabled: animation,
      },
      highlight: {
        lastMove: Boolean(lastMove),
        ...(customSquareClassesMap ? { custom: customSquareClassesMap } : {}),
      },
      ...(lastMove ? { lastMove: [...lastMove] } : {}),
    });
  }, [
    fen,
    dests,
    interactive,
    showDests,
    animation,
    drawable,
    orientation,
    coordinates,
    lastMove,
    customSquareClassesMap,
  ]);

  return (
    <BoardContainer ariaLabel="Chessboard">
      <div
        ref={hostRef}
        className={`cg-wrap ${themeClass(theme)}`}
        data-testid="chessground-host"
        style={{ width: '100%', height: '100%' }}
      />
    </BoardContainer>
  );
}

function themeClass(theme: BoardTheme): string {
  // `cg-brown` is the only theme class that ships pre-styled with
  // `@lichess-org/chessground@10.1.1`. The other themes (`blue`,
  // `green`, `purple`, `wood`) are reserved for future slice-in
  // stylesheets; for V1 they all render with the default
  // brown-style colors so the playground never breaks.
  switch (theme) {
    case 'brown':
      return 'cg-brown';
    case 'blue':
      return 'cg-blue';
    case 'green':
      return 'cg-green';
    case 'purple':
      return 'cg-purple';
    case 'wood':
      return 'cg-wood';
    default:
      return 'cg-brown';
  }
}
