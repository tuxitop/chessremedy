import { useCallback, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Color, Key } from '@lichess-org/chessground/types';
import { fenOf, parsePositionFen } from '@/domain/chess';
import {
  Chessboard,
  type BoardTheme,
  type ChessboardHandle,
  type PieceSet,
} from '@/components/chessboard/Chessboard';
import { MoveList } from '@/components/chessboard/MoveList';
import { Navigation, type NavigationTarget } from '@/components/chessboard/Navigation';
import { PromotionDialog, type PromotionRole } from '@/components/chessboard/PromotionDialog';
import { SettingsPopover, type SettingsState } from '@/components/chessboard/SettingsPopover';
import { useBoardSize } from '@/components/chessboard/useBoardSize';
import { BOARD_SIZE_DEFAULT } from '@/components/chessboard/boardSize';
import {
  play as playMove,
  positionAtPath,
  pathToEnd,
  sideToMoveAt,
  step,
  treeFromFen,
  type MoveTree,
  type Path,
} from '@/components/chessboard/positionTree';
import { hasLegalMoves } from '@/components/chessboard/chessopsAdapter';
import { useAnalysisController } from '@/components/analysis/useAnalysisController';
import { useBrowserAnalysisEngine } from '@/components/analysis/useBrowserAnalysisEngine';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { EvaluationBar } from '@/components/analysis/EvaluationBar';
import { firstMoveSquares } from '@/components/analysis/engineFormat';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import styles from './LiveAnalysisPage.module.css';

type Orientation = 'white' | 'black';

interface SettingsShape {
  orientation: Orientation;
  coordinates: boolean;
  showLegalMoves: boolean;
  animation: boolean;
  drawable: boolean;
  interactive: boolean;
  boardTheme: BoardTheme;
  pieceSet: PieceSet;
}

const DEFAULT_SETTINGS: SettingsShape = {
  orientation: 'white',
  coordinates: true,
  showLegalMoves: true,
  animation: true,
  drawable: true,
  interactive: true,
  boardTheme: 'brown',
  pieceSet: 'cburnett',
};

export const LIVE_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function orientationForFen(fen: string): Orientation {
  const turn = fen.split(/\s+/)[1];
  return turn === 'b' ? 'black' : 'white';
}

export function LiveAnalysisPage(): React.JSX.Element {
  const boardSizeApi = useBoardSize();
  const engine = useBrowserAnalysisEngine();
  const { defaults, isReady } = useEngineDefaults();

  const [startFen, setStartFen] = useState<string>(LIVE_START_FEN);
  const [fenInput, setFenInput] = useState<string>(LIVE_START_FEN);
  const [fenError, setFenError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsShape>(DEFAULT_SETTINGS);

  const initialTree = useMemo(() => treeFromFen(startFen), [startFen]);

  const [tree, setTree] = useState<MoveTree>(initialTree);
  const [path, setPath] = useState<Path>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [moveError, setMoveError] = useState<string | null>(null);
  const chessboardRef = useRef<ChessboardHandle | null>(null);

  const position = useMemo(() => positionAtPath(tree, path), [tree, path]);
  const currentFen = useMemo(() => fenOf(position), [position]);
  const sideToMove = useMemo(() => sideToMoveAt(tree, path) as Orientation, [tree, path]);
  const activePly = path.length > 0 ? path[path.length - 1]! : null;
  const lastMove = useMemo<readonly [string, string] | null>(
    () => (activePly ? [activePly.from, activePly.to] : null),
    [activePly],
  );

  const isCheckmate = position.isCheckmate();
  const isStalemate = position.isStalemate();
  const isDraw = isStalemate || position.isInsufficientMaterial() || position.halfmoves >= 100;
  const finished = isCheckmate || isDraw || !hasLegalMoves(position);

  const controller = useAnalysisController({
    service: engine.service,
    fen: currentFen,
    capabilities: engine.capabilities,
    autoStart: true,
    defaults: isReady ? defaults : null,
  });

  const bestArrow: DrawShape[] = useMemo(() => {
    const line = controller.result?.lines[0];
    if (!line) return [];
    const squares = firstMoveSquares(line);
    if (!squares) return [];
    return [{ orig: squares.from as Key, dest: squares.to as Key, brush: 'green' }];
  }, [controller.result]);

  const resetToFen = useCallback((fen: string) => {
    const parsed = parsePositionFen(fen);
    if (!parsed.ok) {
      setFenError(parsed.message);
      return;
    }
    const canonical = fenOf(parsed.position);
    setFenError(null);
    setStartFen(canonical);
    setFenInput(canonical);
    setSettings((cur) => ({ ...cur, orientation: orientationForFen(canonical) }));
    setTree(treeFromFen(canonical));
    setPath([]);
    setPendingPromotion(null);
    setMoveError(null);
  }, []);

  const handleMove = useCallback(
    (from: string, to: string) => {
      setMoveError(null);
      if (finished) return;
      const result = playMove(tree, path, from, to);
      if (result.error) {
        setMoveError(result.error);
        return;
      }
      setTree(result.tree);
      setPath(result.path);
    },
    [tree, path, finished],
  );

  const handlePromotionSelect = useCallback(
    (role: PromotionRole) => {
      if (!pendingPromotion) return;
      const { from, to } = pendingPromotion;
      setMoveError(null);
      const result = playMove(tree, path, from, to, role);
      setPendingPromotion(null);
      requestAnimationFrame(() => chessboardRef.current?.clearPendingPromotion());
      if (result.error) {
        setMoveError(result.error);
        return;
      }
      setTree(result.tree);
      setPath(result.path);
    },
    [pendingPromotion, tree, path],
  );

  const handlePromotionCancel = useCallback(() => {
    setPendingPromotion(null);
    requestAnimationFrame(() => {
      chessboardRef.current?.clearPendingPromotion();
      if (pendingPromotion) {
        chessboardRef.current?.selectSquare(pendingPromotion.from as Key);
      }
    });
  }, [pendingPromotion]);

  const handleNavigate = useCallback(
    (target: NavigationTarget) => {
      setPendingPromotion(null);
      switch (target) {
        case 'first':
          setPath([]);
          break;
        case 'prev':
          setPath((cur) => step(tree, cur, -1));
          break;
        case 'next':
          setPath((cur) => step(tree, cur, 1));
          break;
        case 'last':
          setPath((cur) => pathToEnd(tree, cur));
          break;
      }
    },
    [tree],
  );

  const handleSeek = useCallback((target: Path) => {
    setPendingPromotion(null);
    setPath(target);
  }, []);

  const handleResetBoardSize = useCallback(() => {
    boardSizeApi.setSize(BOARD_SIZE_DEFAULT);
  }, [boardSizeApi]);

  const settingsForPopover: SettingsState = useMemo(
    () => ({
      orientation: settings.orientation,
      coordinates: settings.coordinates,
      showLegalMoves: settings.showLegalMoves,
      animation: settings.animation,
      drawable: settings.drawable,
      interactive: settings.interactive,
      boardTheme: settings.boardTheme,
      pieceSet: settings.pieceSet,
    }),
    [settings],
  );

  const boardSizePx = boardSizeApi.size;

  return (
    <div className={styles.page} data-testid="live-analysis-page">
      <header className={styles.header}>
        <h1 className={styles.title}>Live Analysis</h1>
        <p className={styles.subtitle}>
          Play any position and analyse it with Stockfish. Every move you make is analysed live.
        </p>
      </header>

      <div className={styles.fenRow}>
        <label className={styles.fenLabel}>
          <span>Starting FEN</span>
          <input
            className={styles.fenInput}
            value={fenInput}
            onChange={(e) => setFenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') resetToFen(fenInput);
            }}
            data-testid="live-fen-input"
          />
        </label>
        <button
          type="button"
          className={styles.fenButton}
          onClick={() => resetToFen(fenInput)}
          data-testid="live-fen-set"
        >
          Set position
        </button>
        {fenError && (
          <span className={styles.fenError} role="alert" data-testid="live-fen-error">
            {fenError}
          </span>
        )}
      </div>

      <div className={styles.layout}>
        <section
          className={styles.boardColumn}
          aria-label="Chessboard"
          style={!boardSizeApi.isMobile ? { width: boardSizePx } : undefined}
        >
          <Chessboard
            ref={chessboardRef}
            position={position}
            orientation={settings.orientation as Color}
            coordinates={settings.coordinates}
            showLegalMoves={settings.showLegalMoves}
            animation={settings.animation}
            drawable={settings.drawable}
            interactive={settings.interactive}
            moving={pendingPromotion === null && !finished}
            boardTheme={settings.boardTheme}
            pieceSet={settings.pieceSet}
            lastMove={lastMove as readonly [Key, Key] | null}
            autoShapes={bestArrow}
            boardSize={boardSizeApi}
            onMove={handleMove}
            onPromotionRequired={(p) => setPendingPromotion(p)}
          />
          <div className={styles.resetRow}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => resetToFen(startFen)}
              data-testid="live-reset"
            >
              Reset position
            </button>
          </div>
          {(fenError || moveError) && (
            <div className={styles.positionError} role="alert" data-testid="live-position-error">
              <strong>Could not play position.</strong>
              <pre className={styles.errorMessage}>{fenError ?? moveError}</pre>
            </div>
          )}
        </section>

        <div className={styles.evalBarColumn}>
          <EvaluationBar
            evaluation={
              controller.result && controller.result.lines.length > 0
                ? controller.result.lines[0]!.evaluation
                : null
            }
            bottomColor={settings.orientation}
            sideToMove={sideToMove}
          />
        </div>

        <aside
          className={styles.sidePanel}
          aria-label="Analysis panel"
          style={!boardSizeApi.isMobile ? { height: boardSizePx, width: boardSizePx } : undefined}
        >
          <AnalysisPanel
            controller={controller}
            capabilities={engine.capabilities}
            bottomColor={settings.orientation}
            sideToMove={sideToMove}
            rightSlot={
              <SettingsPopover
                state={settingsForPopover}
                onChange={(next) => setSettings(next)}
                onResetBoardSize={handleResetBoardSize}
                onClearArrows={() => chessboardRef.current?.clearArrows()}
                boardSize={boardSizePx}
              />
            }
          />
          <div className={styles.moveListArea} aria-label="Moves">
            <MoveList tree={tree} path={path} onSeek={handleSeek} />
          </div>
          <div className={styles.controls}>
            <Navigation
              currentPly={path.length}
              totalPlies={pathToEnd(tree, []).length}
              onNavigate={handleNavigate}
            />
            <span className={styles.meta}>
              {finished ? (
                <strong data-testid="game-outcome">{isCheckmate ? 'Checkmate' : 'Draw'}</strong>
              ) : (
                <span>
                  <strong data-testid="side-to-move">{sideToMove}</strong> to move
                </span>
              )}
            </span>
          </div>
        </aside>
      </div>

      <PromotionDialog
        open={pendingPromotion !== null}
        pieceSet={settings.pieceSet}
        onSelect={handlePromotionSelect}
        onCancel={handlePromotionCancel}
      />
    </div>
  );
}
