import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Chessboard, type BoardTheme } from '@/components/chessboard/Chessboard';
import { PgnViewer, type PgnViewerApi } from '@/components/chessboard/PgnViewer';
import { Navigation } from '@/components/chessboard/Navigation';
import {
  PLAYGROUND_FIXTURES,
  findFixture,
  isPgnFixture,
  type PlaygroundFixture,
  type PlaygroundFixtureId,
} from '@/components/chessboard/playgroundFixtures';
import {
  applyChessgroundMove,
  positionFromFen,
  type ChessOpsPosition,
} from '@/components/chessboard/chessopsAdapter';
import { useBoardSize } from '@/components/chessboard/useBoardSize';
import { BOARD_SIZE_DEFAULT } from '@/components/chessboard/boardSize';
import styles from './PlaygroundPage.module.css';

type ThemeOption = 'brown' | 'blue' | 'green' | 'purple' | 'wood';
type PieceSet = 'cburnett' | 'merida' | 'alpha' | 'chess7' | 'spatial';

const DEFAULT_THEME: ThemeOption = 'brown';
const DEFAULT_PIECE_SET: PieceSet = 'cburnett';

export function PlaygroundPage(): React.JSX.Element {
  const [fixtureId, setFixtureId] = useState<PlaygroundFixtureId>('starting');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [coordinates, setCoordinates] = useState<boolean>(true);
  const [showDests, setShowDests] = useState<boolean>(true);
  const [animation, setAnimation] = useState<boolean>(true);
  const [drawable, setDrawable] = useState<boolean>(false);
  const [boardTheme, setBoardTheme] = useState<ThemeOption>(DEFAULT_THEME);
  const [pieceSet, setPieceSet] = useState<PieceSet>(DEFAULT_PIECE_SET);
  const [interactive, setInteractive] = useState<boolean>(true);
  const [pgnApi, setPgnApi] = useState<PgnViewerApi | null>(null);

  // Position state is keyed on the fixture. When the fixture changes,
  // we discard any in-progress game and start at the fixture's FEN.
  const fixture = useMemo<PlaygroundFixture>(() => findFixture(fixtureId), [fixtureId]);
  const fixturePosition = useMemo<ChessOpsPosition>(
    () => positionFromFen(fixture.fen),
    [fixture.fen],
  );

  // React 19 pattern: derive state during render. If the fixture
  // changed and our position is not the fixture's initial position,
  // re-derive it in the same render pass. setState is allowed inside
  // the render body when the new value differs.
  const [position, setPosition] = useState<ChessOpsPosition>(fixturePosition);
  if (position !== fixturePosition) {
    setPosition(fixturePosition);
  }

  // Reset the PGN viewer to "last" when the fixture changes or the
  // viewer API first becomes available. This is a side effect on an
  // external (non-React) object, not a state update, so it can live
  // in useEffect.
  useEffect(() => {
    pgnApi?.goTo('last');
  }, [fixtureId, pgnApi]);

  const board = useBoardSize();

  const handleSelectFixture = useCallback((id: string): void => {
    setFixtureId(id as PlaygroundFixtureId);
  }, []);

  const handleOrientationToggle = useCallback(() => {
    setOrientation((cur) => (cur === 'white' ? 'black' : 'white'));
  }, []);

  const handleCoordinatesToggle = useCallback(() => {
    setCoordinates((cur) => !cur);
  }, []);

  const handleShowDestsToggle = useCallback(() => {
    setShowDests((cur) => !cur);
  }, []);

  const handleAnimationToggle = useCallback(() => {
    setAnimation((cur) => !cur);
  }, []);

  const handleDrawableToggle = useCallback(() => {
    setDrawable((cur) => !cur);
  }, []);

  const handleInteractiveToggle = useCallback(() => {
    setInteractive((cur) => !cur);
  }, []);

  const handleReset = useCallback(() => {
    setPosition(fixturePosition);
    pgnApi?.goTo('last');
  }, [fixturePosition, pgnApi]);

  const handleResetSize = useCallback(() => {
    board.setSize(BOARD_SIZE_DEFAULT);
  }, [board]);

  const handleMove = useCallback((from: string, to: string) => {
    setPosition((cur) => {
      const next = applyChessgroundMove(cur, from as never, to as never);
      if (next) {
        return next;
      }
      return cur;
    });
  }, []);

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
        <section className={styles.boardArea} aria-label="Chessboard">
          <Chessboard
            position={position}
            orientation={orientation}
            coordinates={coordinates}
            showDests={showDests}
            animation={animation}
            drawable={drawable}
            interactive={interactive}
            theme={boardTheme as BoardTheme}
            onMove={handleMove}
          />
        </section>

        {isPgnFixture(fixture) && (
          <aside className={styles.pgnArea} aria-label="PGN move list">
            <PgnViewer
              pgn={fixture.pgn}
              initialFen={fixture.fen}
              orientation={orientation}
              showMoves="bottom"
              showPlayers={false}
              onReady={setPgnApi}
            />
            <Navigation api={pgnApi} />
          </aside>
        )}
      </div>

      <section
        className={styles.controls}
        aria-label="Playground controls"
        data-testid="playground-controls"
      >
        <label className={styles.field}>
          <span>Position</span>
          <select
            data-testid="fixture-select"
            value={fixtureId}
            onChange={(event) => handleSelectFixture(event.target.value)}
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

        <div className={styles.toggleRow}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={orientation === 'black'}
              onChange={handleOrientationToggle}
              data-testid="toggle-orientation"
            />
            <span>Black at bottom</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={coordinates}
              onChange={handleCoordinatesToggle}
              data-testid="toggle-coordinates"
            />
            <span>Coordinates</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showDests}
              onChange={handleShowDestsToggle}
              data-testid="toggle-show-dests"
            />
            <span>Show dests</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={animation}
              onChange={handleAnimationToggle}
              data-testid="toggle-animation"
            />
            <span>Animation</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={drawable}
              onChange={handleDrawableToggle}
              data-testid="toggle-drawable"
            />
            <span>Drawable</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={interactive}
              onChange={handleInteractiveToggle}
              data-testid="toggle-interactive"
            />
            <span>Interactive</span>
          </label>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Board theme</span>
            <select
              data-testid="select-board-theme"
              value={boardTheme}
              onChange={(event) => setBoardTheme(event.target.value as ThemeOption)}
            >
              {(['brown', 'blue', 'green', 'purple', 'wood'] as const).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Piece set</span>
            <select
              data-testid="select-piece-set"
              value={pieceSet}
              onChange={(event) => setPieceSet(event.target.value as PieceSet)}
            >
              {(['cburnett', 'merida', 'alpha', 'chess7', 'spatial'] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              /* arrow clearing is owned by Chessground's drawable
               * API; a future slice will hook this to a drawable
               * ref. */
            }}
            data-testid="clear-arrows"
          >
            Clear arrows
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={handleReset}
            data-testid="reset-position"
          >
            Reset position
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={handleResetSize}
            data-testid="reset-board-size"
          >
            Reset board size
          </button>
        </div>

        <p className={styles.footnote}>
          Board size: {board.size}px. Drag the corner handle to resize (desktop only).
        </p>
      </section>
    </div>
  );
}
