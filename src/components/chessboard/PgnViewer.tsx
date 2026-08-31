import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import startLpv from '@lichess-org/pgn-viewer';
import styles from './PgnViewer.module.css';

// Inject the Lichess PGN viewer stylesheet once per page. The CSS file
// is shipped at `node_modules/@lichess-org/pgn-viewer/dist/lichess-pgn-viewer.css`
// but the package's `exports` map blocks subpath CSS imports. We copy
// the file to `public/vendor/pgn-viewer/` at install time (see
// `scripts/copy-vendor-assets.mjs`) and load it via a `<link>` tag.
const PGN_VIEWER_CSS_URL = '/vendor/pgn-viewer/lichess-pgn-viewer.css';
let stylesInjected = false;
function ensureStylesInjected(): void {
  if (stylesInjected || typeof document === 'undefined') {
    return;
  }
  stylesInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = PGN_VIEWER_CSS_URL;
  link.dataset.testid = 'pgn-viewer-styles';
  document.head.appendChild(link);
}

export type PgnViewerGoTo = 'first' | 'prev' | 'next' | 'last';

export interface PgnViewerProps {
  /** PGN string to render. Required. */
  pgn: string;
  /** Initial FEN if the PGN is a partial game starting from a non-standard position. */
  initialFen?: string;
  /** Board orientation. */
  orientation?: 'white' | 'black';
  /** Whether the move list is visible. */
  showMoves?: false | 'right' | 'bottom' | 'auto';
  /** Whether the player names row is visible. */
  showPlayers?: true | false | 'auto';
  /** Whether the clock controls are visible. */
  showClocks?: boolean;
  /** Whether the viewer's own button row is visible. */
  showControls?: boolean;
  /** Enable keyboard shortcuts to navigate the game. */
  keyboardToMove?: boolean;
  /** Show the engine-analysis arrow overlay. */
  drawArrows?: boolean;
  /** Start at a specific ply or `'last'`. Defaults to `'last'`. */
  initialPly?: number | 'last';
  /** Fired when the viewer is ready. */
  onReady?: (api: PgnViewerApi) => void;
}

/**
 * Minimal imperative facade exposed by the PgnViewer React wrapper.
 * Mirrors the methods documented in `@lichess-org/pgn-viewer`'s
 * `PgnViewer` class.
 */
export interface PgnViewerApi {
  goTo(to: PgnViewerGoTo, focus?: boolean): void;
  canGoTo(to: PgnViewerGoTo): boolean;
  toggleMenu(): void;
  togglePgn(): void;
  flip(): void;
  orientation(): 'white' | 'black';
  destroy(): void;
}

/**
 * React wrapper around `@lichess-org/pgn-viewer`.
 *
 * Owns the viewer's host `<div>` lifecycle, applies the imperative
 * `Opts` configuration once on mount, and exposes a typed
 * `PgnViewerApi` so the caller can navigate (`goTo('next')`,
 * `goTo('prev')`, etc.) from React.
 */
export function PgnViewer({
  pgn,
  initialFen,
  orientation = 'white',
  showMoves = 'auto',
  showPlayers = 'auto',
  showClocks = false,
  showControls = false,
  keyboardToMove = true,
  drawArrows = true,
  initialPly = 'last',
  onReady,
}: PgnViewerProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [api, setApi] = useState<PgnViewerApi | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    ensureStylesInjected();

    const viewer = startLpv(host, {
      pgn,
      ...(initialFen ? { fen: initialFen } : {}),
      orientation,
      chessground: {
        coordinates: true,
        viewOnly: true,
        drawable: { enabled: drawArrows },
      },
      showPlayers,
      showMoves,
      showClocks,
      showControls,
      initialPly,
      scrollToMove: true,
      keyboardToMove,
      drawArrows,
      menu: {
        getPgn: { enabled: false },
        practiceWithComputer: { enabled: false },
        analysisBoard: { enabled: false },
      },
      lichess: false,
    });

    const exposed: PgnViewerApi = {
      goTo: viewer.goTo,
      canGoTo: viewer.canGoTo,
      toggleMenu: viewer.toggleMenu,
      togglePgn: viewer.togglePgn,
      flip: viewer.flip,
      orientation: viewer.orientation,
      destroy: () => {
        viewer.div?.remove();
      },
    };
    setApi(exposed);
    onReady?.(exposed);

    return () => {
      try {
        viewer.div?.remove();
      } catch {
        /* ignore */
      }
      setApi(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pgn]);

  return (
    <div
      className={styles.wrapper}
      data-testid="pgn-viewer"
      data-api-ready={api ? 'true' : 'false'}
    >
      <div ref={hostRef} className={styles.host} />
    </div>
  );
}
