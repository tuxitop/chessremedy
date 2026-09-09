import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Color, Key } from '@lichess-org/chessground/types';
import { makeSan } from 'chessops/san';
import { isNormal } from 'chessops/types';
import { parseUci } from 'chessops/util';
import { Chessboard, type ChessboardHandle } from '@/components/chessboard/Chessboard';
import { DEFAULT_PIECE_SET } from '@/components/chessboard/themes';
import { MoveList } from '@/components/chessboard/MoveList';
import { MoveListPane } from '@/components/chessboard/MoveListPane';
import { Navigation, type NavigationTarget } from '@/components/chessboard/Navigation';
import { PromotionDialog, type PromotionRole } from '@/components/chessboard/PromotionDialog';
import { uciMoveArrow } from '@/components/chessboard/boardShapes';
import { useBoardSize, type UseBoardSize } from '@/components/chessboard/useBoardSize';
import {
  buildSolveLine,
  puzzlePrefixOf,
  type PuzzlePrefix,
  type SolveVariation,
} from '@/components/chessboard/puzzleMoveLine';
import {
  lastMoveFromPath,
  pathToEnd,
  positionAtPath,
  step,
  type Path,
} from '@/components/chessboard/positionTree';
import { AnalysisBoard } from '@/components/analysis/board/AnalysisBoard';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { EvaluationBar } from '@/components/analysis/EvaluationBar';
import { engineArrowShapes } from '@/components/analysis/engineArrows';
import { useAnalysisController } from '@/components/analysis/useAnalysisController';
import { useBrowserAnalysisEngine } from '@/components/analysis/useBrowserAnalysisEngine';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { useAnalysisNavigation } from '@/hooks/useAnalysisNavigation';
import { Button } from '@/components/ui/Button';
import { fenOf, parsePositionFen, type Position } from '@/domain/chess';
import type { MoveAnalysis } from '@/domain/chess';
import { puzzleObjectiveLabel } from '@/domain/puzzle';
import type { PuzzleRow } from '@/domain/puzzle';
import {
  hintContent,
  nextHintLevel,
  type HintLevel,
  type PresentationOutcome,
  type SessionPuzzleContext,
  type SolveHintConfig,
} from '@/domain/training';
import type { PuzzleAttemptRecorderLike } from '@/infrastructure/training';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import { usePuzzleSolve, type MoveSubmission, type WritePhase } from '@/hooks/usePuzzleSolve';
import { formatSolveTime } from './solveText';
import styles from './SolveScreen.module.css';

const PROMOTION_ROLE_LETTER: Readonly<Record<PromotionRole, 'q' | 'r' | 'b' | 'n'>> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

const HINT_HIGHLIGHT_BRUSH = 'yellow';
const WRONG_MOVE_BRUSH = 'red';

/** Visible finish copy for each stored result (single-view, no page swap). */
export const SOLVE_RESULT_LABELS: Readonly<Record<PresentationOutcome['result'], string>> = {
  solvedFirstTry: 'Success',
  solvedWithHelp: 'Solved with hints',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Stored, game-scoped analysis lookup the solve prefix reads (ADR-033). */
export interface StoredAnalysisLookup {
  readonly listForGameAndAnalysis: (
    gameId: string,
    analysisId: string,
  ) => Promise<readonly MoveAnalysis[]>;
}

/** Host contract of the solving screen (Feature 013 supplies these props). */
export interface SolveScreenProps {
  /** The immutable puzzle row being presented. */
  readonly row: PuzzleRow;
  /** Host-supplied set/cycle/presentation coordinates. */
  readonly context: SessionPuzzleContext;
  /** Per-set hint availability/threshold configuration. */
  readonly config: SolveHintConfig;
  /** Outcome-write seam (stubbed in tests; no IndexedDB). */
  readonly recorder: PuzzleAttemptRecorderLike;
  /** Return to the host with the recorded outcome, or `null` on discard. */
  readonly onExit: (outcome: PresentationOutcome | null) => void;
  /** Optional shared board-size API (defaults to the standard sizing hook). */
  readonly boardSize?: UseBoardSize;
  /** Optional stored-analysis seam for the game prefix (defaults to the repo). */
  readonly storedAnalysis?: StoredAnalysisLookup;
  /** Show the solve clock (Settings → Puzzles; default hidden). */
  readonly showTimer?: boolean;
  /**
   * Host seam to re-present the current puzzle from a clean start. Used for the
   * post-finish "Restart" action (the presentation controller has no return
   * path from a recorded outcome to `solving`, so the host remounts the row).
   */
  readonly onRestart?: () => void;
}

/**
 * The Feature-012-owned solving screen (plan 012b single-view redesign): the
 * board is drawable, the right panel is the standard move list (game prefix +
 * played/solution mainline, wrong attempts as variations) with a status line
 * and Hint / View solution / Restart controls, results are shown inside the
 * move-list container, and once the puzzle is finished a Stockfish toggle
 * (off by default) analyses the end position. Hints never fail the puzzle;
 * View solution gives up and plays the stored solution out. The presentation
 * controller (`usePuzzleSolve`) and its write/retry protocol are unchanged.
 */
export function SolveScreen({
  row,
  context,
  config,
  recorder,
  onExit,
  boardSize,
  storedAnalysis = analysesRepository,
  showTimer = false,
  onRestart,
}: SolveScreenProps): React.JSX.Element {
  const controller = usePuzzleSolve({ row, context, config, recorder });
  const ownBoardSize = useBoardSize();
  const resolvedBoardSize = boardSize ?? ownBoardSize;
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  const boardRef = useRef<ChessboardHandle | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const engine = useBrowserAnalysisEngine();
  const { defaults: engineDefaults, isReady: engineDefaultsReady } = useEngineDefaults();

  // Game-prefix records for the move list (loading is near-instant local I/O;
  // solving input waits so variation depths stay consistent with the prefix).
  const [prefixState, setPrefixState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly prefix: PuzzlePrefix | null }
  >({ status: 'loading' });
  useEffect(() => {
    let active = true;
    storedAnalysis
      .listForGameAndAnalysis(row.sourceGameId, row.analysisId)
      .then((records) => {
        if (!active) {
          return;
        }
        setPrefixState({ status: 'ready', prefix: puzzlePrefixOf(row, records) });
      })
      .catch(() => {
        if (active) {
          setPrefixState({ status: 'ready', prefix: null });
        }
      });
    return () => {
      active = false;
    };
  }, [storedAnalysis, row, row.sourceGameId, row.analysisId]);

  // View state over the (re-derived) solve tree; variations are recorded by the
  // mainline depth of the decision node they were tried at. `path` is `null`
  // while the view "follows" the mainline end (the decision / final position);
  // transport and clicks set an explicit line position to browse instead.
  const [path, setPath] = useState<Path | null>(null);
  const [variations, setVariations] = useState<readonly SolveVariation[]>([]);

  const stage = controller.stage;
  const outcome = controller.outcome;
  const finished = stage === 'outcome' || stage === 'postSolve';
  const prefixReady = prefixState.status === 'ready';
  const prefix = prefixState.status === 'ready' ? prefixState.prefix : null;

  const prefixTokens = useMemo(() => prefix?.tokens ?? [], [prefix]);
  const startFen = prefix?.startFen ?? row.startingFen;

  // The mainline the move list shows: the game prefix, then — once a failed
  // give-up lands — the whole stored solution, otherwise the accepted line.
  const suffixTokens = useMemo(
    () => (finished && outcome?.result === 'failed' ? row.bestPv : controller.playedLine),
    [finished, outcome, controller.playedLine, row.bestPv],
  );
  const mainline = useMemo(() => [...prefixTokens, ...suffixTokens], [prefixTokens, suffixTokens]);

  const tree = useMemo(() => {
    const built = buildSolveLine({ startFen, mainline, variations });
    return built.tree;
  }, [startFen, mainline, variations]);

  // Mainline end (the decision position / final position after finish). The
  // board is interactive exactly when the user is viewing this node.
  const leafPath = useMemo(() => pathToEnd(tree, []), [tree]);

  const displayedPath: Path = path === null ? leafPath : path;

  const position = useMemo(() => positionAtPath(tree, displayedPath), [tree, displayedPath]);
  const currentFen = useMemo(() => fenOf(position), [position]);
  const positionSide = (position.turn === 'white' ? 'white' : 'black') as Color;

  const atEnd = pathEquals(displayedPath, leafPath);
  const atDecision = stage === 'solving' && prefixReady && atEnd;

  const lastMove = useMemo(() => {
    const move = lastMoveFromPath(displayedPath);
    return move === null ? null : ([move[0], move[1]] as readonly [Key, Key]);
  }, [displayedPath]);

  // --- solve interactions ----------------------------------------------------

  const handleSeek = useCallback((target: Path) => {
    setPath(target);
  }, []);

  const navigate = useCallback(
    (target: NavigationTarget): void => {
      if (target === 'first') {
        setPath([]);
      } else if (target === 'last') {
        setPath(null);
      } else {
        const next = step(tree, displayedPath, target === 'next' ? 1 : -1);
        setPath(next);
      }
    },
    [tree, displayedPath],
  );

  const navHandlers = useMemo(
    () => ({
      onFirst: () => navigate('first'),
      onPrev: () => navigate('prev'),
      onNext: () => navigate('next'),
      onLast: () => navigate('last'),
    }),
    [navigate],
  );
  useAnalysisNavigation(navHandlers);

  const sanAt = useCallback((position: Position | null, uci: string): string => {
    if (position === null) {
      return uci;
    }
    const move = parseUci(uci);
    if (move === undefined || !isNormal(move) || !position.isLegal(move)) {
      return uci;
    }
    return makeSan(position, move);
  }, []);

  const handleVerdict = useCallback(
    (verdict: MoveSubmission, uci: string | null): void => {
      if (verdict.kind === 'wrong') {
        const text = uci === null ? '' : sanAt(position, uci);
        setAnnouncement(
          `${text === '' ? 'That move' : `${text}`} is not the move that achieves the objective. Try again.`,
        );
      } else if (verdict.kind === 'illegal') {
        setAnnouncement('That is not a legal move here.');
      } else if (verdict.kind === 'solved') {
        setAnnouncement('Solved!');
      } else if (verdict.kind === 'accepted') {
        setAnnouncement(null);
      }
    },
    [position, sanAt],
  );

  const handleBoardMove = useCallback(
    (from: Key, to: Key): void => {
      if (!atDecision) {
        return;
      }
      const decisionDepth = prefixTokens.length + controller.playedLine.length;
      const uci = `${from}${to}`;
      const verdict = controller.playBoardMove(from, to);
      if (verdict.kind === 'wrong') {
        setVariations((current) => [...current, { depth: decisionDepth, uci }]);
      } else {
        // Accepted or solved: follow the (possibly grown) line end.
        setPath(null);
      }
      handleVerdict(verdict, uci);
    },
    [atDecision, prefixTokens.length, controller, handleVerdict],
  );

  const handlePromotionSelect = useCallback(
    (role: PromotionRole): void => {
      if (pendingPromotion === null || !atDecision) {
        return;
      }
      const { from, to } = pendingPromotion;
      const decisionDepth = prefixTokens.length + controller.playedLine.length;
      setPendingPromotion(null);
      boardRef.current?.clearPendingPromotion();
      const uci = `${from}${to}${PROMOTION_ROLE_LETTER[role]}`;
      const verdict = controller.playBoardMove(from, to, PROMOTION_ROLE_LETTER[role]);
      if (verdict.kind === 'wrong') {
        setVariations((current) => [...current, { depth: decisionDepth, uci }]);
      } else {
        setPath(null);
      }
      handleVerdict(verdict, uci);
    },
    [pendingPromotion, atDecision, prefixTokens.length, controller, handleVerdict],
  );

  const handlePromotionCancel = useCallback((): void => {
    setPendingPromotion(null);
    boardRef.current?.clearPendingPromotion();
    boardRef.current?.selectSquare(null);
  }, []);

  const handleRestart = useCallback((): void => {
    controller.restart();
    setVariations([]);
    setPath(null);
    setAnnouncement('Restarted. Try the puzzle again from the start.');
  }, [controller]);

  const start = useMemo(() => startPosition(row), [row]);

  const handleHint = useCallback((): void => {
    if (!controller.canHint || !prefixReady || start === null) {
      return;
    }
    const revealed = controller.revealedHintLevels;
    const reached: HintLevel | null = revealed.length > 0 ? revealed[revealed.length - 1]! : null;
    const level = nextHintLevel(reached, config);
    controller.revealHint();
    if (level !== null) {
      const content = hintContent(level, row, start);
      if (content.ok) {
        setAnnouncement(content.content.text);
      }
    }
  }, [controller, prefixReady, start, config, row]);

  const handleGiveUp = useCallback((): void => {
    controller.giveUp();
    setPath(null);
  }, [controller]);

  const handleNext = useCallback((): void => {
    onExit(controller.exitOutcome());
  }, [controller, onExit]);

  const handleRetryWrite = useCallback((): void => {
    controller.retryWrite();
  }, [controller]);

  // --- board shapes ----------------------------------------------------------

  // Latest revealed hint content is shown as yellow square highlights, then a
  // yellow arrow once the full move is revealed (level 4). Hints cover the
  // first solution move only, so the shapes only ever draw at the first
  // decision point (empty played line — see `autoShapes`).
  const hintShapes = useMemo<readonly DrawShape[]>(() => {
    if (start === null) {
      return [];
    }
    const shapes: DrawShape[] = [];
    const revealed = controller.revealedHintLevels;
    if (revealed.length === 0) {
      return [];
    }
    for (const level of revealed) {
      const content = hintContent(level, row, start);
      if (!content.ok) {
        continue;
      }
      for (const square of content.content.squares) {
        shapes.push({ orig: square as Key, brush: HINT_HIGHLIGHT_BRUSH });
      }
    }
    if (revealed.includes(4)) {
      const arrow = uciMoveArrow(row.bestMove, HINT_HIGHLIGHT_BRUSH);
      if (arrow !== null) {
        shapes.push(arrow);
      }
    }
    return shapes;
  }, [controller.revealedHintLevels, start, row]);

  const wrongArrow = useMemo<DrawShape | null>(() => {
    const uci = controller.lastWrongUci;
    return uci === null ? null : uciMoveArrow(uci, WRONG_MOVE_BRUSH);
  }, [controller.lastWrongUci]);

  // --- post-finish engine -----------------------------------------------------

  const engineController = useAnalysisController({
    service: engine.service,
    fen: finished ? currentFen : null,
    capabilities: engine.capabilities,
    autoStart: false,
    defaults: engineDefaultsReady ? engineDefaults : null,
  });
  const engineOn = finished && engineController.enabled;
  const engineShapes = useMemo<readonly DrawShape[]>(
    () => engineArrowShapes(engineController.lines, engineController.settings.arrows),
    [engineController.lines, engineController.settings.arrows],
  );

  const autoShapes = useMemo<readonly DrawShape[]>(() => {
    if (engineOn) {
      return engineShapes;
    }
    const hintMovesVisible = controller.playedLine.length === 0;
    if (stage === 'solving' && atEnd && hintMovesVisible) {
      return wrongArrow === null ? [...hintShapes] : [wrongArrow, ...hintShapes];
    }
    return [];
  }, [engineOn, engineShapes, stage, atEnd, controller.playedLine.length, wrongArrow, hintShapes]);

  // Focus the objective on presentation start (a11y; stage transitions later).
  useEffect(() => {
    if (stage === 'solving') {
      headingRef.current?.focus();
    }
  }, [row.sourceGameId, row.sourcePly, stage]);

  if (stage === 'error') {
    return (
      <section className={styles.screen} data-testid="solve-screen">
        <h1 className={styles.heading} ref={headingRef} tabIndex={-1}>
          Puzzle could not be loaded
        </h1>
        <p className={styles.errorText} role="alert" data-testid="solve-load-error">
          {controller.loadError}
        </p>
        <div className={styles.controls}>
          <Button variant="primary" onClick={() => onExit(null)} data-testid="solve-exit-error">
            Back to the cycle
          </Button>
        </div>
      </section>
    );
  }

  const objective = puzzleObjectiveLabel(row);
  const toMove = row.sideToMove === 'white' ? 'White' : 'Black';

  const barColumn = engineOn ? (
    <EvaluationBar
      evaluation={engineController.lines.length > 0 ? engineController.lines[0]!.evaluation : null}
      sideToMove={positionSide}
    />
  ) : (
    <div className={styles.reservedBar} aria-hidden="true" data-testid="solve-eval-reserved" />
  );

  const totalPlies = leafPath.length;

  return (
    <section className={styles.screen} data-testid="solve-screen">
      <header className={styles.header}>
        <div>
          <h2
            className={styles.heading}
            ref={headingRef}
            tabIndex={-1}
            data-testid="solve-objective"
          >
            {objective}
          </h2>
          <p className={styles.subtitle} data-testid="solve-subtitle">
            {toMove} to move — find the move that achieves the objective.
          </p>
        </div>
        {showTimer ? (
          <p className={styles.clock} data-testid="solve-clock">
            {formatSolveTime(controller.elapsedMs)}
          </p>
        ) : null}
      </header>

      <AnalysisBoard
        boardSize={resolvedBoardSize}
        dataTestId="solve-layout"
        boardColumn={
          <div className={styles.boardColumn}>
            <div className={styles.boardArea}>
              <Chessboard
                ref={boardRef}
                position={position}
                orientation={row.sideToMove}
                interactive={atDecision && controller.atDecisionPoint}
                drawable
                moving={pendingPromotion === null}
                lastMove={lastMove}
                autoShapes={autoShapes}
                boardSize={resolvedBoardSize}
                onMove={handleBoardMove}
                onPromotionRequired={(pending) => {
                  setPendingPromotion({ from: pending.from, to: pending.to });
                }}
              />
              {controller.loadError !== null ? (
                <p className={styles.errorText} role="alert">
                  {controller.loadError}
                </p>
              ) : null}
            </div>
            <PromotionDialog
              open={pendingPromotion !== null}
              pieceSet={DEFAULT_PIECE_SET}
              onSelect={handlePromotionSelect}
              onCancel={handlePromotionCancel}
            />
          </div>
        }
        bar={barColumn}
        sidePanel={
          <div className={styles.sidePanel}>
            {finished ? (
              <div className={styles.engineBlock}>
                <AnalysisPanel
                  controller={engineController}
                  capabilities={engine.capabilities}
                  fen={currentFen}
                  toggleTestId="solve-engine-toggle"
                />
              </div>
            ) : null}
            <MoveListPane dataTestId="solve-movelist">
              <div className={styles.paneBody}>
                <div className={styles.paneList}>
                  <MoveList
                    tree={tree}
                    path={displayedPath}
                    onSeek={handleSeek}
                    autoScroll={prefixTokens.length > 0}
                  />
                </div>
                <SolvePaneFooter
                  finished={finished}
                  outcome={outcome}
                  solvingControlsVisible={stage === 'solving' && prefixReady && !finished}
                  toMove={toMove}
                  canHint={controller.canHint && atEnd}
                  canRestart={
                    controller.playedLine.length > 0 ||
                    controller.hintCount > 0 ||
                    controller.wrongMoveCount > 0
                  }
                  writePhase={(controller.writePhase ?? 'pending') as WritePhase}
                  writeError={controller.writeError}
                  onHint={handleHint}
                  onSolution={handleGiveUp}
                  onRestart={handleRestart}
                  onNext={handleNext}
                  onRetryWrite={handleRetryWrite}
                  {...(onRestart !== undefined ? { onRestartAfterFinish: onRestart } : {})}
                />
              </div>
            </MoveListPane>
            <div className={styles.navRow}>
              <Navigation
                currentPly={displayedPath.length}
                totalPlies={totalPlies}
                onNavigate={navigate}
              />
              <span className={styles.plyCounter} data-testid="solve-ply">
                {displayedPath.length}/{totalPlies}
              </span>
            </div>
          </div>
        }
        {...(resolvedBoardSize.isMobile
          ? {}
          : { sidePanelStyle: { height: resolvedBoardSize.size } })}
      />

      <p className={styles.srOnly} role="status" data-testid="solve-announcement">
        {announcement ?? ''}
      </p>
    </section>
  );
}

function startPosition(row: PuzzleRow): Position | null {
  const parsed = parsePositionFen(row.startingFen);
  return parsed.ok ? parsed.position : null;
}

function pathEquals(a: Path, b: Path): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]!.id !== b[index]!.id) {
      return false;
    }
  }
  return true;
}

function SolvePaneFooter({
  finished,
  outcome,
  solvingControlsVisible,
  toMove,
  canHint,
  canRestart,
  writePhase,
  writeError,
  onHint,
  onSolution,
  onRestart,
  onNext,
  onRetryWrite,
  onRestartAfterFinish,
}: {
  readonly finished: boolean;
  readonly outcome: PresentationOutcome | null;
  readonly solvingControlsVisible: boolean;
  readonly toMove: string;
  readonly canHint: boolean;
  readonly canRestart: boolean;
  readonly writePhase: WritePhase;
  readonly writeError: string | null;
  readonly onHint: () => void;
  readonly onSolution: () => void;
  readonly onRestart: () => void;
  readonly onNext: () => void;
  readonly onRetryWrite: () => void;
  readonly onRestartAfterFinish?: () => void;
}): React.JSX.Element {
  if (finished) {
    const result = outcome?.result ?? 'failed';
    const tone = result === 'failed' ? styles.resultFailed : styles.resultSuccess;
    const written = writePhase === 'written';
    return (
      <div className={styles.paneFooter}>
        <p className={`${styles.result} ${tone}`} data-testid="solve-result">
          {SOLVE_RESULT_LABELS[result]}
        </p>
        {writeError !== null ? (
          <div className={styles.writeError} role="alert" data-testid="solve-write-error">
            <span>{writeError}</span>
            <Button variant="secondary" onClick={onRetryWrite} data-testid="solve-retry-write">
              Retry save
            </Button>
          </div>
        ) : null}
        <div className={styles.controls}>
          {onRestartAfterFinish !== undefined ? (
            <Button variant="secondary" onClick={onRestartAfterFinish} data-testid="solve-restart">
              Restart
            </Button>
          ) : null}
          <Button variant="primary" disabled={!written} onClick={onNext} data-testid="solve-next">
            Next puzzle
          </Button>
        </div>
      </div>
    );
  }
  if (!solvingControlsVisible) {
    return (
      <div className={styles.paneFooter}>
        <p className={styles.status} data-testid="solve-movelist-status">
          Loading…
        </p>
      </div>
    );
  }
  return (
    <div className={styles.paneFooter}>
      <p className={styles.status} data-testid="solve-movelist-status">
        {toMove} to move…
      </p>
      <div className={styles.controls}>
        <Button variant="secondary" onClick={onHint} disabled={!canHint} data-testid="solve-hint">
          Hint
        </Button>
        <Button variant="secondary" onClick={onSolution} data-testid="solve-solution">
          View solution
        </Button>
        {canRestart ? (
          <Button variant="secondary" onClick={onRestart} data-testid="solve-restart">
            Restart
          </Button>
        ) : null}
      </div>
    </div>
  );
}
