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
  mainlinePathOf,
  puzzlePrefixOf,
  type PuzzlePrefix,
  type SolveVariation,
} from '@/components/chessboard/puzzleMoveLine';
import {
  lastMoveFromPath,
  pathToEnd,
  play as playMove,
  positionAtPath,
  step,
  type MoveTree,
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
import { fenOf, parsePositionFen, uciPvToSan, type Position } from '@/domain/chess';
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
import { usePuzzleSolve, type MoveSubmission } from '@/hooks/usePuzzleSolve';
import { formatSolveTime } from './solveText';
import styles from './SolveScreen.module.css';
import '@/pages/solveBoardHighlights.css';

const PROMOTION_ROLE_LETTER: Readonly<Record<PromotionRole, 'q' | 'r' | 'b' | 'n'>> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

/** Hint arrows/highlights are violet (owner ruling; ~#8b5cf6 in Chessboard). */
const HINT_HIGHLIGHT_BRUSH = 'violet';
/** The board's red arrow is the historical game move (owner ruling). */
const GAME_MOVE_BRUSH = 'red';
/** Chessground square-highlight classes (see `solveBoardHighlights.css`). */
const HINT_SQUARE_CLASS = 'solve-cls-hint';
const WRONG_SQUARE_CLASS = 'solve-cls-wrong';

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
  /**
   * Show the labelled Skip control (Feature 013 cycle host owns availability).
   * Hidden by default so Feature-012 behaviour is unchanged. A click records
   * the single `skipped` row through the controller and then exits the
   * presentation; after a wrong-move fail it only closes the view (no second
   * row), and it never advances an unwritten row.
   */
  readonly allowSkip?: boolean;
}

/**
 * The Feature-012-owned solving screen (plan 012b single-view redesign): the
 * board is drawable, the right panel is the standard move list (game prefix +
 * played/solution mainline, wrong attempts as variations) with a status line
 * and Hint / View solution / Restart controls, results are shown inside the
 * move-list container, and the engine top panel is always present with its
 * toggle locked until the puzzle finishes or a wrong-move fail is recorded,
 * after which a Stockfish analysis of the current position can be toggled on
 * (off by default). Hints never fail the puzzle; View solution gives up and
 * plays the stored solution out. The presentation controller
 * (`usePuzzleSolve`) and its write/retry protocol are unchanged.
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
  allowSkip = false,
}: SolveScreenProps): React.JSX.Element {
  const controller = usePuzzleSolve({ row, context, config, recorder });
  const ownBoardSize = useBoardSize();
  const resolvedBoardSize = boardSize ?? ownBoardSize;
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  // Briefly highlights the squares of a wrong move (red) before the piece snaps
  // back to the decision point (owner ruling: show the played squares, then
  // return to the previous position so the user can keep trying).
  const [wrongHighlight, setWrongHighlight] = useState<{
    readonly from: string;
    readonly to: string;
  } | null>(null);
  // True once the user asked to skip: the effect below exits only after the
  // skipped/failed row is durably written (never advances an unwritten row).
  const skipRequestedRef = useRef(false);
  const skipHandledRef = useRef(false);
  // Bumped on an explicit Restart so the historical game-move arrow (a native
  // user-drawn shape) is re-established there (owner ruling 2).
  const [arrowTick, setArrowTick] = useState(0);
  // Set once the user erases the historical game-move arrow with a board click
  // (Chessground fires `onChange` only for deliberate draw/erase, never for the
  // programmatic wipes). It stays set until an explicit Restart or a fresh
  // puzzle remounts this screen, so the arrow never "comes back" on its own.
  const arrowErasedRef = useRef(false);
  const handleBoardShapesChange = useCallback((shapes: readonly DrawShape[]): void => {
    if (shapes.length === 0) {
      arrowErasedRef.current = true;
    }
  }, []);
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

  const baseTree = useMemo(() => {
    const built = buildSolveLine({ startFen, mainline, variations });
    return built.tree;
  }, [startFen, mainline, variations]);

  // Post-finish free play (owner requirement): once the puzzle is finished the
  // board is interactive like the analysis/review pages and every exploration
  // move is played into the shared position tree (Game-Review semantics). The
  // explored tree is kept only while it was derived from the current base line;
  // a solve/give-up/restart (which rebuilds `baseTree`) discards it. Attempt
  // rows are immutable — exploration never writes.
  const [exploredTree, setExploredTree] = useState<{
    readonly base: MoveTree;
    readonly tree: MoveTree;
  } | null>(null);
  const tree =
    exploredTree !== null && exploredTree.base === baseTree ? exploredTree.tree : baseTree;

  // While a puzzle decision point is open, wrong attempts at the unsolved
  // node are appended into the tree as its children — and with no correct
  // continuation yet the first one occupies `children[0]`, which would make it
  // read as the active mainline. Pin the mainline to end exactly at the
  // decision depth (prefix + played moves) so the board, the ply counter, the
  // transport and the move list never treat a wrong move as a mainline
  // continuation; once the decision is resolved (outcome/postSolve/finish) the
  // pin lifts and every wrong renders as an ordinary variation.
  const pinnedEnd = stage === 'solving' && prefixReady ? mainline.length : undefined;

  // Mainline end (the decision position / final position after finish). The
  // board is interactive exactly when the user is viewing this node.
  const leafPath = useMemo(() => {
    if (pinnedEnd !== undefined) {
      return mainlinePathOf(tree, pinnedEnd);
    }
    return pathToEnd(tree, []);
  }, [tree, pinnedEnd]);

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
        // Never step past the open decision node into a wrong attempt; the
        // user reaches variations by clicking them, and returns with prev/end.
        if (target === 'next' && pinnedEnd !== undefined && next.length > pinnedEnd) {
          setPath(displayedPath);
          return;
        }
        setPath(next);
      }
    },
    [tree, displayedPath, pinnedEnd],
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
      // After the puzzle finishes the board is free-play for analysis: route
      // the move into the shared tree (never the presentation controller, so
      // the recorded attempt stays untouched) and seek to the resulting path.
      if (finished) {
        const result = playMove(tree, displayedPath, from, to);
        if (!result.error) {
          setExploredTree({ base: baseTree, tree: result.tree });
          setPath(result.path);
        }
        return;
      }
      if (!atDecision) {
        return;
      }
      const decisionDepth = prefixTokens.length + controller.playedLine.length;
      const uci = `${from}${to}`;
      const verdict = controller.playBoardMove(from, to);
      if (verdict.kind === 'wrong') {
        setVariations((current) => [...current, { depth: decisionDepth, uci }]);
        setWrongHighlight({ from, to });
      } else {
        // Accepted or solved: follow the (possibly grown) line end.
        setPath(null);
        setWrongHighlight(null);
      }
      handleVerdict(verdict, uci);
    },
    [
      finished,
      tree,
      displayedPath,
      baseTree,
      atDecision,
      prefixTokens.length,
      controller,
      handleVerdict,
    ],
  );

  const handlePromotionSelect = useCallback(
    (role: PromotionRole): void => {
      if (pendingPromotion === null) {
        return;
      }
      const { from, to } = pendingPromotion;
      if (finished) {
        setPendingPromotion(null);
        boardRef.current?.clearPendingPromotion();
        const result = playMove(tree, displayedPath, from, to, role);
        if (!result.error) {
          setExploredTree({ base: baseTree, tree: result.tree });
          setPath(result.path);
        }
        return;
      }
      if (!atDecision) {
        return;
      }
      const decisionDepth = prefixTokens.length + controller.playedLine.length;
      setPendingPromotion(null);
      boardRef.current?.clearPendingPromotion();
      const uci = `${from}${to}${PROMOTION_ROLE_LETTER[role]}`;
      const verdict = controller.playBoardMove(from, to, PROMOTION_ROLE_LETTER[role]);
      if (verdict.kind === 'wrong') {
        setVariations((current) => [...current, { depth: decisionDepth, uci }]);
        setWrongHighlight({ from, to });
      } else {
        setPath(null);
        setWrongHighlight(null);
      }
      handleVerdict(verdict, uci);
    },
    [
      pendingPromotion,
      finished,
      tree,
      displayedPath,
      baseTree,
      atDecision,
      prefixTokens.length,
      controller,
      handleVerdict,
    ],
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
    setWrongHighlight(null);
    setAnnouncement('Restarted. Try the puzzle again from the start.');
    // Restart re-establishes the historical game-move arrow (owner ruling): an
    // erased native arrow returns, a fresh decision point is marked again.
    arrowErasedRef.current = false;
    setArrowTick((tick) => tick + 1);
  }, [controller]);

  const start = useMemo(() => startPosition(row), [row]);

  // The board's red arrow marks the historical move the user actually played
  // in the source game (`row.userMovePlayed`). It is drawn as a NATIVE
  // user-drawn shape (not autoShapes), so the user erases it with a plain
  // board click (Chessground clears drawn shapes when nothing is selected).
  // Chessground also wipes drawn shapes on every wrapper state push, so the
  // arrow is (re-)established on each render that shows the decision node —
  // unless the user deliberately erased it (`arrowErasedRef`), which persists
  // until an explicit Restart or a fresh puzzle (see `handleRestart`).
  const gameMoveArrow = useMemo<DrawShape | null>(
    () => uciMoveArrow(row.userMovePlayed, GAME_MOVE_BRUSH),
    [row.userMovePlayed],
  );
  useEffect(() => {
    if (gameMoveArrow === null) {
      return;
    }
    if (stage !== 'solving' || !prefixReady || finished || !atEnd) {
      return;
    }
    if (arrowErasedRef.current) {
      return;
    }
    boardRef.current?.setShapes([gameMoveArrow]);
  }, [
    gameMoveArrow,
    stage,
    prefixReady,
    finished,
    atEnd,
    arrowTick,
    controller.playedLine.length,
    controller.revealedHintLevels.length,
    variations,
    path,
  ]);

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

  const handleSkip = useCallback((): void => {
    skipRequestedRef.current = true;
    controller.skip();
  }, [controller]);

  // The Feature-013 Skip seam: once a skip was requested and the row is
  // durably written, exit the presentation with its outcome. A retryable write
  // leaves the request pending (no advance); a skip after a wrong-move fail
  // closes the view with the already-written `failed` outcome and no new row.
  useEffect(() => {
    if (!skipRequestedRef.current || skipHandledRef.current) {
      return;
    }
    if (controller.writePhase !== 'written') {
      return;
    }
    skipHandledRef.current = true;
    onExit(controller.exitOutcome());
  }, [controller, onExit]);

  const handleRetryWrite = useCallback((): void => {
    controller.retryWrite();
  }, [controller]);

  // --- board shapes ----------------------------------------------------------

  // Revealed hint squares are painted violet through the Chessboard wrapper's
  // `customSquareClasses` (a plain CSS class per square — see
  // `solveBoardHighlights.css`): level 2 highlights the starting square (so the
  // FIRST press is visibly productive), level 3 adds the destination square,
  // and level 4 reveals the full SAN in text on top of both. Hints cover the
  // first solution move only, so the squares only ever show at the first
  // decision point (empty played line — see `customSquareClasses`).
  const hintSquares = useMemo<readonly Key[]>(() => {
    const revealed = controller.revealedHintLevels;
    if (revealed.length === 0 || start === null) {
      return [];
    }
    const squares = new Set<Key>();
    for (const level of revealed) {
      const content = hintContent(level, row, start);
      if (!content.ok) {
        continue;
      }
      for (const square of content.content.squares) {
        squares.add(square as Key);
      }
    }
    return [...squares];
  }, [controller.revealedHintLevels, start, row]);

  // The only automatic board shape is the violet destination arrow of the first
  // solution move, revealed at levels 3/4; the hint squares are CSS highlights
  // (above) rather than Chessground circles (owner ruling).
  const hintShapes = useMemo<readonly DrawShape[]>(() => {
    const revealed = controller.revealedHintLevels;
    if (!revealed.includes(3) && !revealed.includes(4)) {
      return [];
    }
    const arrow = uciMoveArrow(row.bestMove, HINT_HIGHLIGHT_BRUSH);
    return arrow === null ? [] : [arrow];
  }, [controller.revealedHintLevels, row]);

  // Wrong-move and hint squares are real square highlights (CSS classes), not
  // Chessground circles: a wrong square wins over a hint on the same square.
  // They only show while solving at the decision point, matching `autoShapes`.
  const customSquareClasses = useMemo<ReadonlyMap<Key, string>>(() => {
    const classes = new Map<Key, string>();
    const hintMovesVisible = controller.playedLine.length === 0;
    if (stage === 'solving' && atEnd && hintMovesVisible) {
      for (const square of hintSquares) {
        classes.set(square, HINT_SQUARE_CLASS);
      }
    }
    if (wrongHighlight !== null) {
      classes.set(wrongHighlight.from as Key, WRONG_SQUARE_CLASS);
      classes.set(wrongHighlight.to as Key, WRONG_SQUARE_CLASS);
    }
    return classes;
  }, [stage, atEnd, controller.playedLine.length, hintSquares, wrongHighlight]);

  // SAN of the historical game move (decision-position context) feeds the info
  // text; it falls back to the raw UCI when unparseable.
  const gameMoveSan = useMemo<string | null>(() => {
    if (start === null) {
      return row.userMovePlayed;
    }
    return sanAt(start, row.userMovePlayed);
  }, [row, start, sanAt]);

  const solutionSan = useMemo<string>(() => {
    const pv = uciPvToSan(row.startingFen, [...row.bestPv]);
    return pv.ok ? pv.sans.join(' ') : row.bestPv.join(' ');
  }, [row]);

  // --- post-finish engine -----------------------------------------------------

  const result = outcome?.result ?? null;
  const outcomePresent = outcome !== null;
  // The engine is available once the puzzle is finished OR as soon as a
  // wrong-move fail has been recorded (owner ruling: the puzzle is already
  // failed, so the user may analyse while the presentation stays open).
  const engineAvailable = finished || (outcomePresent && result === 'failed');

  const engineController = useAnalysisController({
    service: engine.service,
    fen: currentFen,
    capabilities: engine.capabilities,
    autoStart: false,
    defaults: engineDefaultsReady ? engineDefaults : null,
  });
  const engineOn = engineAvailable && engineController.enabled;
  const engineShapes = useMemo<readonly DrawShape[]>(
    () => engineArrowShapes(engineController.lines, engineController.settings.arrows),
    [engineController.lines, engineController.settings.arrows],
  );

  // While the engine is off, the only automatic board shape is the violet hint
  // destination arrow (drawn at the first decision point, empty played line).
  // The wrong-move red flash and the hint squares are real square highlights
  // (CSS, see `customSquareClasses`); the board's red arrow is the historical
  // game move (drawn natively above).
  const autoShapes = useMemo<readonly DrawShape[]>(() => {
    if (engineOn) {
      return engineShapes;
    }
    const hintMovesVisible = controller.playedLine.length === 0;
    if (stage === 'solving' && atEnd && hintMovesVisible) {
      return hintShapes;
    }
    return [];
  }, [engineOn, engineShapes, stage, atEnd, controller.playedLine.length, hintShapes]);

  // Clear the wrong-move red flash after a moment (the piece is already back at
  // the decision point; this is transient feedback only).
  useEffect(() => {
    if (wrongHighlight === null) {
      return;
    }
    const id = window.setTimeout(() => setWrongHighlight(null), 900);
    return () => window.clearTimeout(id);
  }, [wrongHighlight]);

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
  const loading = stage === 'solving' && !prefixReady;
  const solvingActive = stage === 'solving' && prefixReady && !finished;
  const written = controller.writePhase === 'written';
  const hintEnabled = controller.canHint && atEnd && solvingActive;
  const canRestart =
    controller.playedLine.length > 0 || controller.hintCount > 0 || controller.wrongMoveCount > 0;
  const resultTone =
    result === 'failed'
      ? styles.resultFailed
      : result === 'solvedWithHelp'
        ? styles.resultHelp
        : styles.resultSuccess;

  const barColumn = engineOn ? (
    <EvaluationBar
      evaluation={engineController.lines.length > 0 ? engineController.lines[0]!.evaluation : null}
      sideToMove={positionSide}
      orientation={resolvedBoardSize.isMobile ? 'horizontal' : 'vertical'}
    />
  ) : (
    <div className={styles.reservedBar} aria-hidden="true" data-testid="solve-eval-reserved" />
  );

  const totalPlies = leafPath.length;

  return (
    <section className={styles.screen} data-testid="solve-screen">
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
                interactive={finished || (atDecision && controller.atDecisionPoint)}
                drawable
                onShapesChange={handleBoardShapesChange}
                moving={pendingPromotion === null}
                lastMove={lastMove}
                autoShapes={autoShapes}
                {...(customSquareClasses.size > 0 ? { customSquareClasses } : {})}
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
            <div className={styles.engineBlock}>
              <AnalysisPanel
                controller={engineController}
                capabilities={engine.capabilities}
                fen={currentFen}
                toggleTestId="solve-engine-toggle"
                disabled={!engineAvailable}
              />
            </div>

            <MoveListPane dataTestId="solve-movelist">
              <MoveList
                tree={tree}
                path={displayedPath}
                onSeek={handleSeek}
                autoScroll={prefixTokens.length > 0}
                {...(pinnedEnd !== undefined ? { pinnedDepth: pinnedEnd } : {})}
              />

              <section
                className={styles.puzzleInfo}
                aria-label="Puzzle information"
                data-testid="solve-puzzle-info"
              >
                <div className={styles.infoHeader}>
                  <h2
                    className={styles.infoTitle}
                    ref={headingRef}
                    tabIndex={-1}
                    data-testid="solve-objective"
                  >
                    {objective}
                  </h2>
                  {showTimer ? (
                    <p className={styles.infoClock} data-testid="solve-clock">
                      {formatSolveTime(controller.elapsedMs)}
                    </p>
                  ) : null}
                </div>

                <div className={styles.infoBody}>
                  {loading ? (
                    <p className={styles.statusLine} data-testid="solve-movelist-status">
                      Loading…
                    </p>
                  ) : solvingActive ? (
                    <>
                      <p className={styles.statusLine} data-testid="solve-movelist-status">
                        {toMove} to move…
                      </p>
                      {gameMoveSan !== null ? (
                        <p className={styles.historical} data-testid="solve-game-move-note">
                          {gameMoveSan} was played in the game — find a better move.
                        </p>
                      ) : null}
                    </>
                  ) : finished && result === 'failed' && controller.foundAfterFail ? (
                    <p className={styles.confirm} data-testid="solve-confirm">
                      Correct! This was recorded as a failed attempt.
                    </p>
                  ) : finished && result === 'failed' ? (
                    <p className={styles.solutionLine} data-testid="solve-solution-line">
                      Solution: {solutionSan}
                    </p>
                  ) : null}

                  {outcomePresent && result !== null ? (
                    <p className={`${styles.result} ${resultTone}`} data-testid="solve-result">
                      {SOLVE_RESULT_LABELS[result]}
                    </p>
                  ) : null}
                </div>

                {outcomePresent && controller.writeError !== null ? (
                  <div className={styles.writeError} role="alert" data-testid="solve-write-error">
                    <span>{controller.writeError}</span>
                    <Button
                      variant="secondary"
                      onClick={handleRetryWrite}
                      data-testid="solve-retry-write"
                    >
                      Retry save
                    </Button>
                  </div>
                ) : null}

                <div className={styles.controls}>
                  {finished ? (
                    <>
                      {onRestart !== undefined ? (
                        <Button variant="secondary" onClick={onRestart} data-testid="solve-restart">
                          Restart
                        </Button>
                      ) : null}
                      <Button
                        variant="primary"
                        disabled={!written}
                        onClick={handleNext}
                        data-testid="solve-next"
                      >
                        Next puzzle
                      </Button>
                    </>
                  ) : solvingActive ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={handleHint}
                        disabled={!hintEnabled}
                        data-testid="solve-hint"
                      >
                        Hint
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleGiveUp}
                        data-testid="solve-solution"
                      >
                        View solution
                      </Button>
                      {allowSkip ? (
                        <Button variant="secondary" onClick={handleSkip} data-testid="solve-skip">
                          Skip
                        </Button>
                      ) : null}
                      {canRestart ? (
                        <Button
                          variant="secondary"
                          onClick={handleRestart}
                          data-testid="solve-restart"
                        >
                          Restart
                        </Button>
                      ) : null}
                      {outcomePresent && result === 'failed' ? (
                        <Button
                          variant="primary"
                          disabled={!written}
                          onClick={handleNext}
                          data-testid="solve-next"
                        >
                          Next puzzle
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </section>
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
