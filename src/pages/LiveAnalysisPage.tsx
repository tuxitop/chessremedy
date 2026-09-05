import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  buildTreeFromPgn,
  play as playMove,
  positionAtPath,
  pathToEnd,
  pathToLanding,
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
import { AnalysisBoard } from '@/components/analysis/board/AnalysisBoard';
import { EvaluationBar } from '@/components/analysis/EvaluationBar';
import { engineArrowShapes } from '@/components/analysis/engineArrows';
import { buildPlyEvaluations } from '@/components/analysis/moveEvals';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { useBoardAppearance } from '@/hooks/useBoardAppearance';
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
  const { defaults: engineDefaults, isReady: engineDefaultsReady } = useEngineDefaults();
  const { defaults: boardDefaults, isReady: boardDefaultsReady } = useBoardAppearance();

  const [fenInput, setFenInput] = useState<string>(LIVE_START_FEN);
  const [pgnInput, setPgnInput] = useState<string>('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [pgnError, setPgnError] = useState<string | null>(null);
  const boardTouched = useRef(false);

  const [baseTree, setBaseTree] = useState<MoveTree>(() => treeFromFen(LIVE_START_FEN));
  const [tree, setTree] = useState<MoveTree>(baseTree);
  const [path, setPath] = useState<Path>([]);
  const [settings, setSettings] = useState<SettingsShape>(DEFAULT_SETTINGS);
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
    defaults: engineDefaultsReady ? engineDefaults : null,
  });

  // Adopt persisted board/theme defaults only until the user tweaks them here.
  useEffect(() => {
    if (!boardDefaultsReady || !boardDefaults || boardTouched.current) return;
    setSettings((cur) => ({
      ...cur,
      boardTheme: boardDefaults.boardTheme,
      pieceSet: boardDefaults.pieceSet,
      coordinates: boardDefaults.coordinates,
      animation: boardDefaults.animation,
    }));
  }, [boardDefaultsReady, boardDefaults]);

  const handleBoardChange = useCallback((next: SettingsShape) => {
    boardTouched.current = true;
    setSettings(next);
  }, []);

  const engineArrows: DrawShape[] = useMemo(
    () => engineArrowShapes(controller.lines, controller.settings.arrows),
    [controller.lines, controller.settings.arrows],
  );

  const plyEvals = useMemo(
    () => buildPlyEvaluations(tree, controller.evalsByFen),
    [tree, controller.evalsByFen],
  );

  const setPositionFromFen = useCallback((raw: string) => {
    const parsed = parsePositionFen(raw);
    if (!parsed.ok) {
      setFenError(parsed.message);
      return;
    }
    const canonical = fenOf(parsed.position);
    setFenError(null);
    setPgnError(null);
    setPgnInput('');
    setFenInput(canonical);
    const nextTree = treeFromFen(canonical);
    setBaseTree(nextTree);
    setTree(nextTree);
    setPath([]);
    setSettings((cur) => ({ ...cur, orientation: orientationForFen(canonical) }));
    setPendingPromotion(null);
    setMoveError(null);
  }, []);

  const loadPgn = useCallback(() => {
    const built = buildTreeFromPgn(pgnInput);
    if (built.error) {
      setPgnError(built.error);
      return;
    }
    setPgnError(null);
    setFenError(null);
    setFenInput(built.tree.startFen);
    const landing = pathToLanding(built.tree);
    setBaseTree(built.tree);
    setTree(built.tree);
    setPath(landing);
    const landingPos = positionAtPath(built.tree, landing);
    setSettings((cur) => ({ ...cur, orientation: orientationForFen(fenOf(landingPos)) }));
    setPendingPromotion(null);
    setMoveError(null);
  }, [pgnInput]);

  const handleReset = useCallback(() => {
    setTree(baseTree);
    setPath([]);
    setPendingPromotion(null);
    setMoveError(null);
  }, [baseTree]);

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
  const headerError = fenError ?? pgnError ?? moveError;

  return (
    <div className={styles.page} data-testid="live-analysis-page">
      <header className={styles.header}>
        <h1 className={styles.title}>Live Analysis</h1>
        <p className={styles.subtitle}>
          Play any position and analyse it with Stockfish. Every move you make is analysed live.
        </p>
      </header>

      {headerError && (
        <div className={styles.positionError} role="alert" data-testid="live-position-error">
          <strong>Could not load position.</strong>
          <pre className={styles.errorMessage}>{headerError}</pre>
        </div>
      )}

      <AnalysisBoard
        boardSize={boardSizeApi}
        boardColumn={
          <section aria-label="Chessboard">
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
              autoShapes={engineArrows}
              boardSize={boardSizeApi}
              onMove={handleMove}
              onPromotionRequired={(p) => setPendingPromotion(p)}
            />
            <div className={styles.resetRow}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={handleReset}
                data-testid="live-reset"
              >
                Reset position
              </button>
            </div>
          </section>
        }
        bar={
          <EvaluationBar
            evaluation={controller.lines.length > 0 ? controller.lines[0]!.evaluation : null}
            bottomColor={settings.orientation}
            sideToMove={sideToMove}
          />
        }
        sidePanel={
          <>
            <AnalysisPanel
              controller={controller}
              capabilities={engine.capabilities}
              fen={currentFen}
              bottomColor={settings.orientation}
              sideToMove={sideToMove}
              rightSlot={
                <SettingsPopover
                  state={settingsForPopover}
                  onChange={handleBoardChange}
                  onResetBoardSize={handleResetBoardSize}
                  onClearArrows={() => chessboardRef.current?.clearArrows()}
                  boardSize={boardSizePx}
                />
              }
            />
            <div className={styles.moveListArea} aria-label="Moves">
              <MoveList tree={tree} path={path} onSeek={handleSeek} plyEvals={plyEvals} />
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
          </>
        }
        {...(boardSizeApi.isMobile
          ? {}
          : { sidePanelStyle: { height: boardSizePx, width: boardSizePx } })}
        surface
      />

      <section className={styles.sourceBar} aria-label="Position sources">
        <div className={styles.sourceGroup}>
          <span className={styles.sourceTitle}>Start from FEN</span>
          <div className={styles.sourceControls}>
            <input
              className={styles.sourceInput}
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setPositionFromFen(fenInput);
              }}
              data-testid="live-fen-input"
            />
            <button
              type="button"
              className={styles.sourceButton}
              onClick={() => setPositionFromFen(fenInput)}
              data-testid="live-fen-set"
            >
              Set FEN
            </button>
          </div>
        </div>

        <div className={styles.sourceGroup}>
          <span className={styles.sourceTitle}>…or load a game from PGN</span>
          <div className={styles.sourceControls}>
            <textarea
              className={styles.sourceTextarea}
              value={pgnInput}
              onChange={(e) => setPgnInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) loadPgn();
              }}
              rows={3}
              spellCheck={false}
              placeholder={'1. e4 e5 2. Nf3 Nc6 3. Bc4\n5. O-O Be7 6. Re1 b5'}
              data-testid="live-pgn-input"
            />
            <button
              type="button"
              className={styles.sourceButton}
              onClick={loadPgn}
              data-testid="live-pgn-set"
            >
              Load PGN
            </button>
          </div>
        </div>
      </section>

      <PromotionDialog
        open={pendingPromotion !== null}
        pieceSet={settings.pieceSet}
        onSelect={handlePromotionSelect}
        onCancel={handlePromotionCancel}
      />
    </div>
  );
}
