import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Color, Key } from '@lichess-org/chessground/types';
import { fenOf } from '@/domain/chess';
import { ENGINE_POSITIONS } from '@/infrastructure/engine/fixtures/enginePositions';
import { useBrowserAnalysisEngine } from '@/components/analysis/useBrowserAnalysisEngine';
import { useAnalysisController } from '@/components/analysis/useAnalysisController';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { EvaluationBar } from '@/components/analysis/EvaluationBar';
import { engineArrowShapes } from '@/components/analysis/engineArrows';
import { buildPlyEvaluations } from '@/components/analysis/moveEvals';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { useBoardAppearance } from '@/hooks/useBoardAppearance';
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
import { SquareBadges, type SquareBadgeItem } from '@/components/chessboard/SquareBadges';
import { useBoardSize } from '@/components/chessboard/useBoardSize';
import { BOARD_SIZE_DEFAULT } from '@/components/chessboard/boardSize';
import { commentShapesToDrawShapes } from '@/components/chessboard/boardShapes';
import {
  PLAYGROUND_FIXTURES,
  isPgnFixture,
  type FenFixture,
  type PlaygroundFixture,
  type PlaygroundFixtureId,
} from '@/components/chessboard/playgroundFixtures';
import {
  buildTreeFromPgn,
  pathToEnd,
  pathToLanding,
  play as playMove,
  positionAtPath,
  sideToMoveAt,
  step,
  treeFromFen,
  type MoveTree,
  type Path,
} from '@/components/chessboard/positionTree';
import { hasLegalMoves, kingSquare } from '@/components/chessboard/chessopsAdapter';
import { nagMeta } from '@/components/chessboard/pgnAnnotations';
import styles from './PlaygroundPage.module.css';

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
  drawable: false,
  interactive: true,
  boardTheme: 'brown',
  pieceSet: 'cburnett',
};

/** Engine-verification positions shown as extra selectable FEN fixtures. */
const ENGINE_FIXTURES: readonly FenFixture[] = ENGINE_POSITIONS.map((p) => ({
  id: p.id,
  kind: 'fen',
  label: p.label,
  fen: p.fen,
  exercises: p.exercises,
}));

/** Everything selectable on the playground board. */
const ALL_FIXTURES: readonly PlaygroundFixture[] = [...PLAYGROUND_FIXTURES, ...ENGINE_FIXTURES];

export type SelectableFixtureId = PlaygroundFixtureId | (typeof ENGINE_POSITIONS)[number]['id'];

function findSelectableFixture(id: SelectableFixtureId): PlaygroundFixture {
  const found = ALL_FIXTURES.find((f) => f.id === id);
  if (!found) {
    throw new Error(`Unknown playground fixture: ${id}`);
  }
  return found;
}

function buildFixtureTree(fixture: PlaygroundFixture): { tree: MoveTree; error: string | null } {
  if (isPgnFixture(fixture)) {
    const result = buildTreeFromPgn(fixture.pgn);
    return { tree: result.tree, error: result.error ?? null };
  }
  return { tree: treeFromFen(fixture.fen), error: null };
}

/**
 * Default bottom colour for a fixture: Black at the bottom when the board
 * lands on a position where Black is to move and the game is not over
 * (the classic "solve from here" orientation). Positions where White is to
 * move, and finished positions, always open White at the bottom.
 */
function landingOrientation(fixture: PlaygroundFixture): Orientation {
  const { tree } = buildFixtureTree(fixture);
  const landing = pathToLanding(tree);
  const position = positionAtPath(tree, landing);
  const side = sideToMoveAt(tree, landing);
  if (side === 'black' && !position.isEnd()) {
    return 'black';
  }
  return 'white';
}

export function PlaygroundPage(): React.JSX.Element {
  const [fixtureId, setFixtureId] = useState<SelectableFixtureId>('starting');
  const [settings, setSettings] = useState<SettingsShape>(DEFAULT_SETTINGS);
  const boardSizeApi = useBoardSize();
  const boardTouched = useRef(false);
  const { defaults: boardDefaults, isReady: boardDefaultsReady } = useBoardAppearance();
  const [manualOrientations, setManualOrientations] = useState<
    Record<SelectableFixtureId, Orientation>
  >({});

  // Adopt persisted board/theme defaults until the user tweaks them here.
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

  const fixture = useMemo<PlaygroundFixture>(() => findSelectableFixture(fixtureId), [fixtureId]);
  const built = useMemo(() => buildFixtureTree(fixture), [fixture]);

  const handleSelectFixture = useCallback(
    (id: SelectableFixtureId) => {
      if (id === fixtureId) {
        return;
      }
      const next = findSelectableFixture(id);
      const orientation = manualOrientations[id] ?? landingOrientation(next);
      setSettings((cur) => ({ ...cur, orientation }));
      setFixtureId(id);
    },
    [fixtureId, manualOrientations],
  );

  const handleSettingsChange = useCallback(
    (next: SettingsShape) => {
      boardTouched.current = true;
      setSettings((cur) => {
        if (next.orientation !== cur.orientation) {
          setManualOrientations((prev) => ({ ...prev, [fixtureId]: next.orientation }));
        }
        return next;
      });
    },
    [fixtureId],
  );

  return (
    <PlaygroundContent
      key={fixtureId}
      fixture={fixture}
      tree={built.tree}
      buildError={built.error}
      settings={settings}
      onSettingsChange={handleSettingsChange}
      onSelectFixture={handleSelectFixture}
      boardSizeApi={boardSizeApi}
    />
  );
}

interface PlaygroundContentProps {
  fixture: PlaygroundFixture;
  tree: MoveTree;
  buildError: string | null;
  settings: SettingsShape;
  onSettingsChange: (next: SettingsShape) => void;
  onSelectFixture: (id: SelectableFixtureId) => void;
  boardSizeApi: ReturnType<typeof useBoardSize>;
}

function PlaygroundContent(props: PlaygroundContentProps): React.JSX.Element {
  const {
    fixture,
    tree: initialTree,
    buildError,
    settings,
    onSettingsChange,
    onSelectFixture,
    boardSizeApi,
  } = props;

  const [tree, setTree] = useState<MoveTree>(initialTree);
  const [path, setPath] = useState<Path>(() => pathToLanding(initialTree));
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [moveError, setMoveError] = useState<string | null>(null);
  const chessboardRef = useRef<ChessboardHandle | null>(null);

  const position = useMemo(() => positionAtPath(tree, path), [tree, path]);
  const currentFen = useMemo(() => fenOf(position), [position]);
  const sideToMove = useMemo<Orientation>(() => sideToMoveAt(tree, path), [tree, path]);

  const engine = useBrowserAnalysisEngine();
  const { defaults, isReady } = useEngineDefaults();
  const engineController = useAnalysisController({
    service: engine.service,
    fen: currentFen,
    capabilities: engine.capabilities,
    autoStart: false,
    defaults: isReady ? defaults : null,
  });
  const activePly = path.length > 0 ? path[path.length - 1]! : null;
  const lastMove = useMemo<readonly [string, string] | null>(
    () => (activePly ? [activePly.from, activePly.to] : null),
    [activePly],
  );

  const autoShapes: DrawShape[] = useMemo(
    () => (activePly ? commentShapesToDrawShapes(activePly.comments) : []),
    [activePly],
  );

  // Engine arrows layered on top of any comment-driven shapes.
  const engineShapes: DrawShape[] = useMemo(
    () => engineArrowShapes(engineController.lines, engineController.settings.arrows),
    [engineController.lines, engineController.settings.arrows],
  );
  const allShapes = useMemo(() => [...autoShapes, ...engineShapes], [autoShapes, engineShapes]);
  const plyEvals = useMemo(
    () => buildPlyEvaluations(tree, engineController.evalsByFen),
    [tree, engineController.evalsByFen],
  );

  const isCheckmate = position.isCheckmate();
  const isStalemate = position.isStalemate();
  const isDraw = isStalemate || position.isInsufficientMaterial() || position.halfmoves >= 100;
  const finished = isCheckmate || isDraw || !hasLegalMoves(position);

  const badges = useMemo<SquareBadgeItem[]>(() => {
    const items: SquareBadgeItem[] = [];
    if (activePly && activePly.nags.length > 0) {
      const meta = nagMeta(activePly.nags[0]!);
      if (meta) {
        items.push({
          square: activePly.to,
          text: activePly.nags.map((n) => nagMeta(n)?.glyph ?? '').join(''),
          color: meta.color,
          kind: 'nag',
          testId: 'nag-badge',
        });
      }
    }
    if (isCheckmate) {
      const king = kingSquare(position, position.turn);
      if (king) {
        items.push({
          square: king,
          text: '#',
          color: '#c4261c',
          kind: 'mate',
          testId: 'mate-badge',
        });
      }
    } else if (isDraw) {
      // Show a grey draw chip above both kings (stalemate / insufficient
      // material / fifty-move).
      const white = kingSquare(position, 'white');
      const black = kingSquare(position, 'black');
      if (white) {
        items.push({
          square: white,
          text: '\u00bd',
          color: '#6b7280',
          kind: 'draw',
          testId: 'draw-badge',
        });
      }
      if (black) {
        items.push({
          square: black,
          text: '\u00bd',
          color: '#6b7280',
          kind: 'draw',
          testId: 'draw-badge',
        });
      }
    }
    return items;
  }, [activePly, isCheckmate, isDraw, position]);

  const handleMove = useCallback(
    (from: string, to: string) => {
      setMoveError(null);
      if (finished) {
        return;
      }
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

  const handlePromotionRequired = useCallback((pending: { from: string; to: string }) => {
    setPendingPromotion(pending);
  }, []);

  const handlePromotionSelect = useCallback(
    (role: PromotionRole) => {
      if (!pendingPromotion) {
        return;
      }
      const { from, to } = pendingPromotion;
      setMoveError(null);
      const result = playMove(tree, path, from, to, role);
      setPendingPromotion(null);
      // Let the new position flush first, then unfreeze Chessground so it
      // syncs to the promoted position (pawn -> chosen piece) in place.
      requestAnimationFrame(() => {
        chessboardRef.current?.clearPendingPromotion();
      });
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
    const from = pendingPromotion?.from ?? null;
    setPendingPromotion(null);
    // Wait for the frozen-input state to lift before clearing the pending
    // move and re-selecting the source square so the user can retry.
    requestAnimationFrame(() => {
      chessboardRef.current?.clearPendingPromotion();
      if (from) {
        chessboardRef.current?.selectSquare(from as Key);
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

  const handleResetPosition = useCallback(() => {
    setPath(pathToLanding(tree));
    setMoveError(null);
    setPendingPromotion(null);
    chessboardRef.current?.clearPendingPromotion();
  }, [tree]);

  const handleResetBoardSize = useCallback(() => {
    boardSizeApi.setSize(BOARD_SIZE_DEFAULT);
  }, [boardSizeApi]);

  const handleClearArrows = useCallback(() => {
    chessboardRef.current?.clearArrows();
  }, []);

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
    <div className={styles.page} data-testid="playground-page">
      <header className={styles.header}>
        <h1 className={styles.title}>Chessboard Playground</h1>
        <p className={styles.subtitle}>
          Exercise every Chessboard capability without importing a game. Fixtures are local to this
          page; nothing is written to your database.
        </p>
      </header>

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
            autoShapes={allShapes}
            overlay={<SquareBadges orientation={settings.orientation as Color} items={badges} />}
            boardSize={boardSizeApi}
            onMove={handleMove}
            onPromotionRequired={handlePromotionRequired}
          />
          <div className={styles.fixtureControls}>
            <label className={styles.field}>
              <span>Position</span>
              <select
                data-testid="fixture-select"
                value={fixture.id}
                onChange={(e) => onSelectFixture(e.target.value as SelectableFixtureId)}
              >
                {ALL_FIXTURES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.exercises} data-testid="fixture-exercises">
              {fixture.exercises}
            </p>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleResetPosition}
              data-testid="reset-position"
            >
              Reset position
            </button>
          </div>
          {(buildError || moveError) && (
            <div className={styles.positionError} role="alert" data-testid="position-error">
              <strong>Could not replay fixture.</strong>
              <pre className={styles.errorMessage}>{buildError ?? moveError}</pre>
            </div>
          )}
        </section>

        <div
          className={styles.evalBar}
          style={!boardSizeApi.isMobile ? { height: boardSizePx } : undefined}
        >
          <EvaluationBar
            evaluation={
              engineController.lines.length > 0 ? engineController.lines[0]!.evaluation : null
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
            controller={engineController}
            capabilities={engine.capabilities}
            fen={currentFen}
            bottomColor={settings.orientation}
            sideToMove={sideToMove}
            rightSlot={
              <SettingsPopover
                state={settingsForPopover}
                onChange={onSettingsChange}
                onResetBoardSize={handleResetBoardSize}
                onClearArrows={handleClearArrows}
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

export { DEFAULT_SETTINGS };
