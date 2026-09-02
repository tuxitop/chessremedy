import { useCallback, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Color, Key } from '@lichess-org/chessground/types';
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
  findFixture,
  isPgnFixture,
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
import { kingSquare } from '@/components/chessboard/chessopsAdapter';
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

function buildFixtureTree(fixture: PlaygroundFixture): { tree: MoveTree; error: string | null } {
  if (isPgnFixture(fixture)) {
    const result = buildTreeFromPgn(fixture.pgn);
    return { tree: result.tree, error: result.error ?? null };
  }
  return { tree: treeFromFen(fixture.fen), error: null };
}

/**
 * Default bottom color for a fixture: Black at the bottom only when the
 * board lands on a position where Black is to move and the game is not
 * over (the classic "solve from here" orientation).
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
  const [fixtureId, setFixtureId] = useState<PlaygroundFixtureId>('starting');
  const [settings, setSettings] = useState<SettingsShape>(DEFAULT_SETTINGS);
  const boardSizeApi = useBoardSize();
  const [manualOrientations, setManualOrientations] = useState<
    Record<PlaygroundFixtureId, Orientation>
  >({});

  const fixture = useMemo<PlaygroundFixture>(() => findFixture(fixtureId), [fixtureId]);
  const built = useMemo(() => buildFixtureTree(fixture), [fixture]);

  const handleSelectFixture = useCallback(
    (id: PlaygroundFixtureId) => {
      if (id === fixtureId) {
        return;
      }
      const next = findFixture(id);
      const orientation = manualOrientations[id] ?? landingOrientation(next);
      setSettings((cur) => ({ ...cur, orientation }));
      setFixtureId(id);
    },
    [fixtureId, manualOrientations],
  );

  const handleSettingsChange = useCallback(
    (next: SettingsShape) => {
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
  onSelectFixture: (id: PlaygroundFixtureId) => void;
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
  const sideToMove = useMemo<Orientation>(() => sideToMoveAt(tree, path), [tree, path]);
  const activePly = path.length > 0 ? path[path.length - 1]! : null;
  const lastMove = useMemo<readonly [string, string] | null>(
    () => (activePly ? [activePly.from, activePly.to] : null),
    [activePly],
  );

  const autoShapes: DrawShape[] = useMemo(
    () => (activePly ? commentShapesToDrawShapes(activePly.comments) : []),
    [activePly],
  );

  const isMate = position.isCheckmate();

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
    if (isMate) {
      const king = kingSquare(position, position.turn);
      if (king) {
        items.push({ square: king, text: '#', color: '#c33', kind: 'mate', testId: 'mate-badge' });
      }
    }
    return items;
  }, [activePly, isMate, position]);

  const handleMove = useCallback(
    (from: string, to: string) => {
      setMoveError(null);
      const result = playMove(tree, path, from, to);
      if (result.error) {
        setMoveError(result.error);
        return;
      }
      setTree(result.tree);
      setPath(result.path);
    },
    [tree, path],
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
      chessboardRef.current?.clearPendingPromotion();
      setPendingPromotion(null);
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
        <section className={styles.boardColumn} aria-label="Chessboard">
          <Chessboard
            ref={chessboardRef}
            position={position}
            orientation={settings.orientation as Color}
            coordinates={settings.coordinates}
            showLegalMoves={settings.showLegalMoves}
            animation={settings.animation}
            drawable={settings.drawable}
            interactive={settings.interactive}
            moving={pendingPromotion === null}
            boardTheme={settings.boardTheme}
            pieceSet={settings.pieceSet}
            lastMove={lastMove as readonly [Key, Key] | null}
            autoShapes={autoShapes}
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
                onChange={(e) => onSelectFixture(e.target.value as PlaygroundFixtureId)}
              >
                {PLAYGROUND_FIXTURES.map((f) => (
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

        <aside
          className={styles.sidePanel}
          aria-label="Analysis panel"
          style={!boardSizeApi.isMobile ? { height: boardSizePx } : undefined}
        >
          <div className={styles.sideHeader}>
            <span className={styles.sideTitle}>Analysis</span>
            <SettingsPopover
              state={settingsForPopover}
              onChange={onSettingsChange}
              onResetBoardSize={handleResetBoardSize}
              onClearArrows={handleClearArrows}
              boardSize={boardSizePx}
            />
          </div>

          <div className={styles.engineLines} aria-label="Engine lines">
            <span className={styles.engineTitle}>Engine</span>
            <p className={styles.engineHint}>
              Engine lines and evaluations appear here after Stockfish is wired in (Feature 005).
            </p>
          </div>

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
              <span>
                <strong data-testid="side-to-move">{sideToMove}</strong> to move
              </span>
              <span>
                Board: <strong data-testid="board-size">{boardSizePx}</strong>px
              </span>
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
