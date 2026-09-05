import { useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  buildTreeFromPgn,
  positionAtPath,
  pathToEnd,
  sideToMoveAt,
  step,
} from '@/components/chessboard/positionTree';
import type { MovePly, MoveTree, Path } from '@/components/chessboard/positionTree';
import { Chessboard } from '@/components/chessboard/Chessboard';
import { useBoardSize, type UseBoardSize } from '@/components/chessboard/useBoardSize';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { MoveList } from '@/components/chessboard/MoveList';
import { MoveListPane } from '@/components/chessboard/MoveListPane';
import { Navigation, type NavigationTarget } from '@/components/chessboard/Navigation';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import { formatEvaluation } from '@/components/analysis/engineFormat';
import { EvaluationBar } from '@/components/analysis/EvaluationBar';
import { AnalysisBoard } from '@/components/analysis/board/AnalysisBoard';
import { engineArrowBrush, engineArrowShapes } from '@/components/analysis/engineArrows';
import { buildPlyEvaluations } from '@/components/analysis/moveEvals';
import { useAnalysisController } from '@/components/analysis/useAnalysisController';
import { useBrowserAnalysisEngine } from '@/components/analysis/useBrowserAnalysisEngine';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { useAnalysisNavigation } from '@/hooks/useAnalysisNavigation';
import { gameFromPgn } from '@/domain/chess/parseGame';
import { gameClocks, type MoveClock } from '@/domain/chess/clock';
import { parseTimeControl } from '@/domain/chess/timeControl';
import { fenOf, uciPvToSan } from '@/domain/chess';
import type { EvalCpMate, MoveAnalysis, MoveClassification, Wdl } from '@/domain/chess';
import { classifyMove, cpValueOf } from '@/domain/chess/classification';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import { summarizeAnalysis, CLASSIFICATION_LABELS } from '@/domain/analysis/summary';
import type { AnalysisJob, GameAnalysisStatus } from '@/domain/analysis';
import { useGameReview } from '@/hooks/useGameReview';
import { useGameAnalysis, type AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { getBrowserAnalysisService } from '@/infrastructure/analysis';
import { Button } from '@/components/ui/Button';
import styles from './GameReviewPage.module.css';

/** Classification → NAG (ADR-023 glyphs `?? ? ?! ! !!`), read-only. */
export const CLASSIFICATION_NAG: Readonly<Record<MoveClassification, number>> = {
  best: 3, // !!
  good: 1, // !
  inaccuracy: 6, // ?!
  mistake: 2, // ?
  blunder: 4, // ??
};

interface GameReviewPageProps {
  /** Injectable for tests; defaults to the browser analysis service. */
  readonly analysisService?: AnalysisServiceLike | null;
}

export function GameReviewPage({ analysisService }: GameReviewPageProps): React.JSX.Element {
  const { id = '' } = useParams<'id'>();
  const [builtService, setBuiltService] = useState<AnalysisServiceLike | null>(null);
  const data = useGameReview(id);
  const actions = useGameAnalysis(analysisService !== undefined ? analysisService : builtService);
  const [running, setRunning] = useState(false);
  const [serviceOutdated, setServiceOutdated] = useState(false);
  const effectiveService = analysisService !== undefined ? analysisService : builtService;

  useEffect(() => {
    if (analysisService !== undefined) {
      return;
    }
    let active = true;
    getBrowserAnalysisService()
      .then((service) => {
        if (active) {
          setBuiltService(service);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [analysisService]);

  // The engine-aware "outdated" flag (ADR-020 / §22) mirrors the Game
  // Library: a completed analysis produced before the current engine is
  // offered an opt-in re-analysis. Re-fetched whenever the shown job changes.
  useEffect(() => {
    if (!effectiveService || !id) {
      return;
    }
    let active = true;
    effectiveService
      .statusesOf([id])
      .then((statuses) => {
        if (active) {
          setServiceOutdated(statuses[id] === 'outdated');
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [effectiveService, id, data.job?.id]);

  const runAnalysis = (): void => {
    if (running || !id) {
      return;
    }
    setRunning(true);
    void actions
      .analyze([id])
      .catch(() => undefined)
      .finally(() => {
        setRunning(false);
        data.reload();
      });
  };

  // While a job is queued/in-progress, refresh persisted progress.
  useEffect(() => {
    if (data.status !== 'queued' && data.status !== 'inProgress') {
      return;
    }
    const timer = setInterval(() => data.reload(), 1500);
    return () => clearInterval(timer);
  }, [data.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data.loading) {
    return (
      <StatePanel title="Loading analysis…" description="Reading the stored game and analysis." />
    );
  }
  if (!data.game) {
    return <StatePanel title="Game not found" description="This game may have been deleted." />;
  }

  if (data.status === 'completed' && data.job && data.records.length > 0) {
    return (
      <GameReview
        pgn={data.game.pgn}
        userColor={data.game.userColor}
        playerLabel={playerLabel(data.game)}
        records={data.records}
        obsolete={data.obsolete || serviceOutdated}
        onReanalyze={runAnalysis}
        reanalyzing={running}
      />
    );
  }

  const actionLabel =
    data.status === 'unanalyzed' || data.status === 'failed' || data.status === 'cancelled'
      ? data.status === 'unanalyzed'
        ? 'Analyze this game'
        : 'Retry analysis'
      : null;

  return (
    <StatePanel
      title={statusTitle(data.status)}
      description={statusDescription(data.status, data.job, data.progress)}
      actionDisabled={running}
      onAction={runAnalysis}
      {...(actionLabel !== null ? { actionLabel } : {})}
    />
  );
}

function GameReview({
  pgn,
  userColor,
  playerLabel,
  records,
  obsolete,
  onReanalyze,
  reanalyzing,
}: {
  pgn: string;
  userColor: 'white' | 'black';
  playerLabel: string;
  records: readonly MoveAnalysis[];
  obsolete: boolean;
  onReanalyze: () => void;
  reanalyzing: boolean;
}): React.JSX.Element {
  const built = useMemo(() => buildTreeFromPgn(pgn), [pgn]);
  const tree = built.error ? null : built.tree;
  const [path, setPath] = useState<Path>([]);
  const [live, setLive] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [showEvals, setShowEvals] = useState(true);
  const boardSize = useBoardSize();

  const mainline = useMemo(() => mainlineOf(tree), [tree]);
  const position = useMemo(() => (tree ? positionAtPath(tree, path) : null), [tree, path]);
  const lastMove = useMemo(() => {
    const last = path[path.length - 1];
    return last ? ([last.from, last.to] as readonly [Key, Key]) : null;
  }, [path]);
  const nagOverrides = useMemo(() => buildNagOverrides(mainline, records), [mainline, records]);
  const summary = useMemo(() => summarizeAnalysis(records, userColor), [records, userColor]);
  const clocks = useMemo(() => {
    const parsed = gameFromPgn(pgn, { source: 'fixture', userColor });
    return parsed.ok ? gameClocks(parsed.game.moves) : [];
  }, [pgn, userColor]);
  const clockByPlyId = useMemo(() => clockMapForMainline(mainline, clocks), [mainline, clocks]);
  const evalByPlyId = useMemo(() => storedEvalsByPly(mainline, records), [mainline, records]);
  const onMainlinePrefix = useMemo(() => isMainlinePrefix(path, mainline), [path, mainline]);

  const navigate = useMemo(
    () =>
      (target: NavigationTarget): void => {
        if (!tree) {
          return;
        }
        if (target === 'first') {
          setPath([]);
        } else if (target === 'last') {
          setPath(pathToEnd(tree, path));
        } else {
          setPath(step(tree, path, target === 'next' ? 1 : -1));
        }
      },
    [tree, path],
  );

  // Player names + initial clock (fallback before any %clk) for the bars
  // around the board.
  const gameMeta = useMemo(() => {
    const parsed = gameFromPgn(pgn, { source: 'fixture', userColor });
    if (!parsed.ok) {
      return null;
    }
    return {
      whiteName: parsed.game.whitePlayer.name,
      blackName: parsed.game.blackPlayer.name,
      timeControl: parsed.game.timeControl,
    };
  }, [pgn, userColor]);
  const initialClockMs = useMemo(() => {
    if (!gameMeta) {
      return null;
    }
    const control = parseTimeControl(gameMeta.timeControl);
    return control.baseSeconds !== null ? control.baseSeconds * 1000 : null;
  }, [gameMeta]);
  const opponentName =
    gameMeta === null
      ? 'Opponent'
      : userColor === 'white'
        ? gameMeta.blackName
        : gameMeta.whiteName;
  const userName =
    gameMeta === null ? 'You' : userColor === 'white' ? gameMeta.whiteName : gameMeta.blackName;
  const opponentMs = remainingClockForColor(
    path.length,
    oppositeOf(userColor),
    clocks,
    initialClockMs,
  );
  const userMs = remainingClockForColor(path.length, userColor, clocks, initialClockMs);

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

  const activePly = path[path.length - 1];
  const activeMainIndex = activePly ? mainline.findIndex((node) => node.id === activePly.id) : -1;

  // Stored evaluation shown on the bar: the evaluation of the currently
  // displayed position, re-expressed from that position's side-to-move
  // perspective (EvaluationBar contract). `evalAfter` is stored from the
  // mover's perspective, so for a position after the selected move the bar
  // value is its negation (the opponent is to move there). The start
  // position has no record of its own — use the first move's `evalBefore`
  // (its mover is White, the side to move at the start).
  const barView = useMemo(() => {
    if (!showEvals) {
      return { evaluation: null, sideToMove: 'white' as const };
    }
    if (path.length === 0) {
      const first = records[0];
      return first
        ? {
            evaluation: fromCpMate(first.evalBefore),
            sideToMove: 'white' as const,
          }
        : { evaluation: null, sideToMove: 'white' as const };
    }
    if (onMainlinePrefix && activeMainIndex >= 0) {
      const record = records[activeMainIndex];
      if (record) {
        return {
          evaluation: negateEngineEval(fromCpMate(record.evalAfter)),
          sideToMove: oppositeOf(record.side),
        };
      }
    }
    return { evaluation: null, sideToMove: 'white' as const };
  }, [showEvals, path, onMainlinePrefix, activeMainIndex, records]);

  // Best-move arrows describe the currently displayed position: the move the
  // engine recommends for the side to move there (stored in the record whose
  // `positionFen` is the displayed one).
  const arrows = useMemo<readonly DrawShape[]>(() => {
    if (!showArrows || !onMainlinePrefix) {
      return [];
    }
    const record = records[path.length];
    const uci = record?.bestMove?.uci ?? record?.bestPv[0];
    if (!record || !uci) {
      return [];
    }
    return [
      {
        orig: uci.slice(0, 2) as Key,
        dest: uci.slice(2, 4) as Key,
        brush: engineArrowBrush(0),
      },
    ];
  }, [showArrows, onMainlinePrefix, path, records]);

  if (!tree || !position) {
    return (
      <StatePanel title="Cannot display game" description="The stored PGN could not be replayed." />
    );
  }

  const selected = activeMainIndex >= 0 ? records[activeMainIndex] : undefined;
  const clockMs = activePly ? clockByPlyId.get(activePly.id) : undefined;
  const currentPly = path.length;
  const totalPlies = tree ? pathToEnd(tree, []).length : 0;
  const sidePanelStyle = !boardSize.isMobile ? { height: boardSize.size } : undefined;

  return (
    <div className={styles.page} data-testid="game-review-page">
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} data-testid="review-back" to="/games">
            ← Game Library
          </Link>
          <h1 className={styles.heading}>Game Review</h1>
          <p className={styles.subtitle} data-testid="review-game-label">
            {playerLabel}
          </p>
          <EngineChip record={records[0]} />
        </div>
        {obsolete && !live ? (
          <div className={styles.obsolete} data-testid="review-obsolete" role="note">
            <span>This analysis used an older analysis version.</span>
            <Button
              variant="secondary"
              data-testid="review-reanalyze"
              disabled={reanalyzing}
              onClick={onReanalyze}
            >
              Re-analyze
            </Button>
          </div>
        ) : null}
      </header>

      {!live ? <ReviewSummary summary={summary} userColor={userColor} /> : null}

      {live ? (
        <ReviewLiveSurface
          tree={tree}
          path={path}
          position={position}
          userColor={userColor}
          lastMove={lastMove}
          opponentName={opponentName}
          opponentMs={opponentMs}
          userName={userName}
          userMs={userMs}
          currentPly={currentPly}
          totalPlies={totalPlies}
          onNavigate={navigate}
          onSeek={setPath}
          boardSize={boardSize}
          sidePanelStyle={sidePanelStyle}
          {...(selected !== undefined ? { selectedRecord: selected } : {})}
          {...(activePly !== undefined ? { selectedPlyId: activePly.id } : {})}
          storedNagOverrides={nagOverrides}
          onExitLive={() => setLive(false)}
        />
      ) : (
        <AnalysisBoard
          boardSize={boardSize}
          dataTestId="review-layout"
          {...(sidePanelStyle !== undefined ? { sidePanelStyle } : {})}
          boardColumn={
            <BoardPane
              boardSize={boardSize}
              position={position}
              userColor={userColor}
              lastMove={lastMove}
              arrows={arrows}
              opponentName={opponentName}
              opponentMs={opponentMs}
              userName={userName}
              userMs={userMs}
            />
          }
          bar={
            showEvals ? (
              <EvaluationBar
                evaluation={barView.evaluation}
                bottomColor={userColor}
                sideToMove={barView.sideToMove}
              />
            ) : null
          }
          sidePanel={
            <>
              <ReviewControls
                arrows={showArrows}
                lines={showLines}
                evals={showEvals}
                onArrows={setShowArrows}
                onLines={setShowLines}
                onEvals={setShowEvals}
                onEnterLive={() => setLive(true)}
              />
              <MoveDetails
                record={selected}
                userColor={userColor}
                showEvals={showEvals}
                showLines={showLines}
                {...(clockMs !== undefined ? { clockMs } : {})}
              />
              <MoveListPane>
                <MoveList
                  tree={tree}
                  path={path}
                  onSeek={setPath}
                  nagOverrides={nagOverrides}
                  {...(showEvals ? { plyEvals: evalByPlyId } : {})}
                />
              </MoveListPane>
              <div className={styles.navRow}>
                <Navigation currentPly={currentPly} totalPlies={totalPlies} onNavigate={navigate} />
                <span className={styles.plyCounter} data-testid="review-ply">
                  {currentPly}/{totalPlies}
                </span>
              </div>
            </>
          }
        />
      )}
    </div>
  );
}

/** Shared board column of both Review modes: clock bars around the board. */
function BoardPane({
  boardSize,
  position,
  userColor,
  lastMove,
  arrows,
  opponentName,
  opponentMs,
  userName,
  userMs,
}: {
  boardSize: UseBoardSize;
  position: ReturnType<typeof positionAtPath>;
  userColor: 'white' | 'black';
  lastMove: readonly [Key, Key] | null;
  arrows: readonly DrawShape[];
  opponentName: string;
  opponentMs: number | null;
  userName: string;
  userMs: number | null;
}): React.JSX.Element {
  return (
    <div className={styles.boardStack}>
      <ClockBar name={opponentName} timeMs={opponentMs} dataTestId="review-clock-opponent" />
      <Chessboard
        position={position}
        interactive={false}
        orientation={userColor}
        lastMove={lastMove}
        autoShapes={arrows}
        boardSize={boardSize}
      />
      <ClockBar name={userName} timeMs={userMs} dataTestId="review-clock-user" />
    </div>
  );
}

/** Player name + remaining time (Lichess-style, clock on the right). */
function ClockBar({
  name,
  timeMs,
  dataTestId,
}: {
  name: string;
  timeMs: number | null;
  dataTestId: string;
}): React.JSX.Element {
  return (
    <div className={styles.clockBar} data-testid={dataTestId}>
      <span className={styles.clockName}>{name}</span>
      <span className={styles.clockTime} data-testid={`${dataTestId}-time`}>
        {timeMs === null ? '—' : formatClock(timeMs)}
      </span>
    </div>
  );
}

/** Display toggles + live-analysis entry for the stored surface. */
function ReviewControls({
  arrows,
  lines,
  evals,
  onArrows,
  onLines,
  onEvals,
  onEnterLive,
}: {
  arrows: boolean;
  lines: boolean;
  evals: boolean;
  onArrows: (next: boolean) => void;
  onLines: (next: boolean) => void;
  onEvals: (next: boolean) => void;
  onEnterLive: () => void;
}): React.JSX.Element {
  return (
    <section
      className={styles.controls}
      data-testid="review-controls"
      aria-label="Analysis controls"
    >
      <ToggleButton
        dataTestId="review-toggle-arrows"
        label="Best-move arrows"
        checked={arrows}
        onChange={onArrows}
      />
      <ToggleButton
        dataTestId="review-toggle-lines"
        label="Engine lines"
        checked={lines}
        onChange={onLines}
      />
      <ToggleButton
        dataTestId="review-toggle-evals"
        label="Evaluations"
        checked={evals}
        onChange={onEvals}
      />
      <button
        type="button"
        className={styles.liveButton}
        onClick={onEnterLive}
        data-testid="review-enter-live"
      >
        Live analysis
      </button>
    </section>
  );
}

function ToggleButton({
  dataTestId,
  label,
  checked,
  onChange,
}: {
  dataTestId: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? styles.toggleOn : styles.toggleOff}
      onClick={() => onChange(!checked)}
      data-testid={dataTestId}
    >
      {label}
    </button>
  );
}

/** Live-analysis mode of the Review board (ADR-033): runs the engine on the
 * selected position. Results are session-only and never persist (no write
 * path exists here); the user returns to the stored review. */
function ReviewLiveSurface({
  tree,
  path,
  position,
  userColor,
  lastMove,
  opponentName,
  opponentMs,
  userName,
  userMs,
  currentPly,
  totalPlies,
  onNavigate,
  onSeek,
  boardSize,
  sidePanelStyle,
  selectedRecord,
  selectedPlyId,
  storedNagOverrides,
  onExitLive,
}: {
  tree: MoveTree;
  path: Path;
  position: ReturnType<typeof positionAtPath>;
  userColor: 'white' | 'black';
  lastMove: readonly [Key, Key] | null;
  opponentName: string;
  opponentMs: number | null;
  userName: string;
  userMs: number | null;
  currentPly: number;
  totalPlies: number;
  onNavigate: (target: NavigationTarget) => void;
  onSeek: (path: Path) => void;
  boardSize: UseBoardSize;
  sidePanelStyle: React.CSSProperties | undefined;
  /** Stored record of the selected mainline move (for the live overlay). */
  selectedRecord?: MoveAnalysis;
  selectedPlyId?: number;
  storedNagOverrides: ReadonlyMap<number, readonly number[]>;
  onExitLive: () => void;
}): React.JSX.Element {
  const engine = useBrowserAnalysisEngine();
  const { defaults: engineDefaults, isReady: engineDefaultsReady } = useEngineDefaults();
  const currentFen = useMemo(() => fenOf(position), [position]);
  const sideToMove = useMemo(() => sideToMoveAt(tree, path), [tree, path]);

  const controller = useAnalysisController({
    service: engine.service,
    fen: currentFen,
    capabilities: engine.capabilities,
    autoStart: true,
    defaults: engineDefaultsReady ? engineDefaults : null,
  });

  const arrows = useMemo(
    () => engineArrowShapes(controller.lines, controller.settings.arrows),
    [controller.lines, controller.settings.arrows],
  );
  const plyEvals = useMemo(
    () => buildPlyEvaluations(tree, controller.evalsByFen),
    [tree, controller.evalsByFen],
  );

  // Ephemeral live classification of the selected move: keep the stored
  // "before" context (evalBefore/best move/legal moves/phase) and substitute
  // the live evaluation of the position after the move (re-expressed from the
  // mover's perspective) through the canonical classifier. Shown only while
  // live and never persisted (ADR-033).
  const liveOverlay = useMemo(() => {
    if (!selectedRecord || selectedPlyId === undefined) {
      return null;
    }
    const line = controller.lines[0];
    if (!line) {
      return null;
    }
    const afterRaw = engineEvalToCpMate(line.evaluation);
    const wdlAfter = line.wdl;
    const useWdl = wdlAfter !== null && selectedRecord.wdlBefore !== null;
    const classification = classifyMove({
      evalBefore: selectedRecord.evalBefore,
      evalAfter: negateCpMate(afterRaw),
      bestMove: selectedRecord.bestMove,
      playedMove: selectedRecord.playedMove,
      legalMovesCount: selectedRecord.legalMovesCount,
      wdlBefore: useWdl ? selectedRecord.wdlBefore : null,
      wdlAfter: useWdl ? swapWdl(wdlAfter) : null,
      gamePhase: selectedRecord.gamePhase,
      inBook: false,
      topCpValues: selectedRecord.multipvLines.map((mv) => cpValueOf(mv.evaluation)),
    });
    return { classification, san: selectedRecord.playedMove.san };
  }, [controller.lines, selectedRecord, selectedPlyId]);

  const liveNagOverrides = useMemo(() => {
    const map = new Map<number, readonly number[]>(storedNagOverrides);
    if (liveOverlay && selectedPlyId !== undefined) {
      map.set(selectedPlyId, [CLASSIFICATION_NAG[liveOverlay.classification]]);
    }
    return map;
  }, [storedNagOverrides, liveOverlay, selectedPlyId]);

  return (
    <AnalysisBoard
      boardSize={boardSize}
      dataTestId="review-live-layout"
      {...(sidePanelStyle !== undefined ? { sidePanelStyle } : {})}
      boardColumn={
        <BoardPane
          boardSize={boardSize}
          position={position}
          userColor={userColor}
          lastMove={lastMove}
          arrows={arrows}
          opponentName={opponentName}
          opponentMs={opponentMs}
          userName={userName}
          userMs={userMs}
        />
      }
      bar={
        <EvaluationBar
          evaluation={controller.lines.length > 0 ? controller.lines[0]!.evaluation : null}
          bottomColor={userColor}
          sideToMove={sideToMove}
        />
      }
      sidePanel={
        <>
          <div className={styles.liveBanner} data-testid="review-live-label">
            <strong>Live analysis</strong>
            <span className={styles.liveHint}>
              Engine results are temporary and never overwrite the stored analysis.
            </span>
            {liveOverlay ? (
              <span className={styles.liveClass} data-testid="review-live-class">
                Live: {liveOverlay.san} is {liveOverlay.classification}
              </span>
            ) : null}
            <Button variant="secondary" data-testid="review-exit-live" onClick={onExitLive}>
              Return to stored review
            </Button>
          </div>
          <AnalysisPanel
            controller={controller}
            capabilities={engine.capabilities}
            fen={currentFen}
            bottomColor={userColor}
            sideToMove={sideToMove}
          />
          <MoveListPane>
            <MoveList
              tree={tree}
              path={path}
              onSeek={onSeek}
              plyEvals={plyEvals}
              nagOverrides={liveNagOverrides}
            />
          </MoveListPane>
          <div className={styles.navRow}>
            <Navigation currentPly={currentPly} totalPlies={totalPlies} onNavigate={onNavigate} />
            <span className={styles.plyCounter} data-testid="review-live-ply">
              {currentPly}/{totalPlies}
            </span>
          </div>
        </>
      }
    />
  );
}

function EngineChip({ record }: { record: MoveAnalysis | undefined }): React.JSX.Element | null {
  if (!record) {
    return null;
  }
  const engine = record.engine;
  return (
    <p className={styles.engineChip} data-testid="review-engine-chip">
      {engine.engineName} {engine.engineVersion} · {engine.profile}
    </p>
  );
}

/** Stored evaluation of the selected move/position, plus engine lines. */
function MoveDetails({
  record,
  userColor,
  clockMs,
  showEvals,
  showLines,
}: {
  record: MoveAnalysis | undefined;
  userColor: 'white' | 'black';
  clockMs?: number;
  showEvals: boolean;
  showLines: boolean;
}): React.JSX.Element | null {
  if (!record) {
    return null;
  }
  const whiteAfter = evalAsWhite(record.evalAfter, record.side);
  const isUserError =
    record.side === userColor &&
    (record.classification === 'inaccuracy' ||
      record.classification === 'mistake' ||
      record.classification === 'blunder');
  return (
    <section className={styles.details} data-testid="review-details" aria-label="Move details">
      {clockMs !== undefined ? (
        <p className={styles.clock} data-testid="review-clock">
          Clock {formatClock(clockMs)}
        </p>
      ) : null}
      {showEvals && record.evalAfter ? (
        <p className={styles.evalLine} data-testid="review-eval">
          {whiteAfter ? formatEvaluation(whiteAfter) : ''} after this move
        </p>
      ) : null}
      {record.depth !== undefined ? (
        <p className={styles.depth} data-testid="review-depth">
          Depth {record.depth}
        </p>
      ) : null}
      {isUserError && record.bestMove ? (
        <div className={styles.verdict} data-testid="review-verdict">
          <p className={styles.verdictPlayed}>
            You played {record.playedMove.san} ({record.classification})
          </p>
          <p className={styles.verdictBest}>Best: {record.bestMove.san}</p>
          <p className={styles.verdictSwing} data-testid="review-swing">
            {evalBeforeAfter(record)}
          </p>
        </div>
      ) : null}
      {showLines ? <EngineLines record={record} /> : null}
    </section>
  );
}

function EngineLines({ record }: { record: MoveAnalysis }): React.JSX.Element | null {
  if (record.multipvLines.length === 0) {
    return null;
  }
  return (
    <div className={styles.lines} data-testid="engine-lines">
      <h3 className={styles.linesTitle}>Engine line</h3>
      {record.multipvLines.map((line, index) => (
        <p className={styles.line} key={`${record.analysisId}-${index}`}>
          <span className={styles.lineEval}>{evalText(line.evaluation, record.side)}</span>
          <span className={styles.linePv}>{pvText(record.positionFen, line.uci)}</span>
          {line.depth !== undefined ? (
            <span className={styles.lineMeta}>depth {line.depth}</span>
          ) : null}
        </p>
      ))}
    </div>
  );
}

function ReviewSummary({
  summary,
  userColor,
}: {
  summary: ReturnType<typeof summarizeAnalysis>;
  userColor: 'white' | 'black';
}): React.JSX.Element {
  return (
    <section className={styles.summary} data-testid="review-summary" aria-label="Review summary">
      <h2 className={styles.summaryTitle}>Summary</h2>
      <SummarySide label={`You (${userColor})`} counts={summary.user} dataTestId="summary-user">
        {summary.userMissedTactics > 0 ? (
          <span className={styles.missed} data-testid="summary-missed-tactics">
            {summary.userMissedTactics} missed tactic
            {summary.userMissedTactics === 1 ? '' : 's'}
          </span>
        ) : null}
      </SummarySide>
      <SummarySide label="Opponent" counts={summary.opponent} dataTestId="summary-opponent" />
    </section>
  );
}

function SummarySide({
  label,
  counts,
  dataTestId,
  children,
}: {
  label: string;
  counts: Record<MoveClassification, number>;
  dataTestId: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.summarySide}>
      <h3 className={styles.sideLabel}>{label}</h3>
      <ul className={styles.counts} data-testid={dataTestId}>
        {CLASSIFICATION_LABELS.map((classification) => (
          <li
            className={styles.countRow}
            key={classification}
            data-testid={`${dataTestId}-${classification}`}
          >
            <span className={styles.countName}>{classification}</span>
            <span
              className={styles.countValue}
              data-testid={`${dataTestId}-${classification}-value`}
            >
              {counts[classification]}
            </span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

function StatePanel({
  title,
  description,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.page} data-testid="review-state">
      <Link className={styles.backLink} data-testid="review-back" to="/games">
        ← Game Library
      </Link>
      <section className={styles.statePanel}>
        <h1 className={styles.stateTitle}>{title}</h1>
        <p className={styles.stateDescription}>{description}</p>
        {actionLabel ? (
          <Button data-testid="review-action" disabled={actionDisabled} onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function statusTitle(status: GameAnalysisStatus | null): string {
  switch (status) {
    case 'unanalyzed':
      return 'No analysis yet';
    case 'queued':
      return 'Analysis queued';
    case 'inProgress':
      return 'Analysis in progress';
    case 'failed':
      return 'Analysis failed';
    case 'cancelled':
      return 'Analysis cancelled';
    case 'completed':
      return 'No moves analyzed';
    default:
      return 'No analysis yet';
  }
}

function statusDescription(
  status: GameAnalysisStatus | null,
  job: AnalysisJob | null,
  progress: { done: number; total: number } | null,
): string {
  switch (status) {
    case 'unanalyzed':
      return 'Analyze this game to review its moves.';
    case 'queued':
      return 'This game is waiting for the engine.';
    case 'inProgress':
      return progress
        ? `Analyzed ${progress.done} of ${progress.total} positions…`
        : 'The engine is analyzing this game…';
    case 'failed':
      return job?.lastError
        ? `Analysis failed: ${job.lastError}`
        : 'Analysis failed. Retry analysis.';
    case 'cancelled':
      return 'Analysis was cancelled. Retry analysis.';
    default:
      return 'This game has no analyzed moves yet.';
  }
}

function playerLabel(game: {
  whitePlayer: { name: string };
  blackPlayer: { name: string };
  result: string;
  source: keyof typeof GAME_SOURCE_LABELS;
  timeControl: string;
}): string {
  return `${game.whitePlayer.name} vs ${game.blackPlayer.name} · ${game.result} · ${
    GAME_SOURCE_LABELS[game.source]
  }`;
}

/** First-child chain (the mainline) of the review move tree. */
function mainlineOf(tree: MoveTree | null): readonly MovePly[] {
  if (!tree) {
    return [];
  }
  const out: MovePly[] = [];
  let children = tree.rootChildren;
  while (children.length > 0) {
    const node = children[0]!;
    out.push(node);
    children = node.children;
  }
  return out;
}

/** True when `path` walks only the mainline (each ply is the first child). */
function isMainlinePrefix(path: Path, mainline: readonly MovePly[]): boolean {
  for (let i = 0; i < path.length; i += 1) {
    if (path[i]!.id !== mainline[i]?.id) {
      return false;
    }
  }
  return true;
}

function oppositeOf(color: 'white' | 'black'): 'white' | 'black' {
  return color === 'white' ? 'black' : 'white';
}

/** Map each persisted record (by ply) onto the mainline ply's classification NAG. */
function buildNagOverrides(
  mainline: readonly MovePly[],
  records: readonly MoveAnalysis[],
): ReadonlyMap<number, readonly number[]> {
  const overrides = new Map<number, readonly number[]>();
  records.forEach((record, ply) => {
    const node = mainline[ply];
    if (node) {
      overrides.set(node.id, [CLASSIFICATION_NAG[record.classification]]);
    }
  });
  return overrides;
}

/** Stored evaluation of a side's perspective, re-expressed from White's view. */
function evalAsWhite(
  evaluation: EvalCpMate | null | undefined,
  side: MoveAnalysis['side'],
): EngineEvaluation | null {
  if (!evaluation) {
    return null;
  }
  const flip = side === 'black';
  if (evaluation.cp !== null) {
    return { cp: flip ? -evaluation.cp : evaluation.cp };
  }
  if (evaluation.mate !== null) {
    return { mate: flip ? -evaluation.mate : evaluation.mate };
  }
  return null;
}

/** `EvalCpMate` → display evaluation (cp-only or mate-only), or `null`. */
/** Live engine line evaluation → domain cp/mate shape. */
function engineEvalToCpMate(evaluation: EngineEvaluation): EvalCpMate {
  return 'mate' in evaluation
    ? { cp: null, mate: evaluation.mate }
    : { cp: evaluation.cp, mate: null };
}

/** Negate an evaluation to the opposite side's perspective (cp/mate). */
function negateCpMate(evaluation: EvalCpMate): EvalCpMate {
  return {
    cp: evaluation.cp !== null ? -evaluation.cp : null,
    mate: evaluation.mate !== null ? -evaluation.mate : null,
  };
}

/** Swap a WDL triplet to the opposite perspective (w ↔ l). */
function swapWdl(wdl: Wdl): Wdl {
  return { w: wdl.l, d: wdl.d, l: wdl.w };
}

function fromCpMate(evaluation: EvalCpMate): EngineEvaluation | null {
  if (evaluation.cp !== null) {
    return { cp: evaluation.cp };
  }
  if (evaluation.mate !== null) {
    return { mate: evaluation.mate };
  }
  return null;
}

/** Negate a display evaluation to the opposite side's perspective. */
function negateEngineEval(evaluation: EngineEvaluation | null): EngineEvaluation | null {
  if (!evaluation) {
    return null;
  }
  return 'mate' in evaluation ? { mate: -evaluation.mate } : { cp: -evaluation.cp };
}

function evalText(evaluation: EvalCpMate, side: MoveAnalysis['side']): string {
  const white = evalAsWhite(evaluation, side);
  return white ? formatEvaluation(white) : '';
}

function evalBeforeAfter(record: MoveAnalysis): string {
  const before = evalAsWhite(record.evalBefore, record.side);
  const after = evalAsWhite(record.evalAfter, record.side);
  return `${before ? formatEvaluation(before) : '?'} → ${after ? formatEvaluation(after) : '?'}`;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function pvText(fen: string, uci: readonly string[]): string {
  if (uci.length === 0) {
    return '';
  }
  const converted = uciPvToSan(fen, [...uci]);
  return converted.ok ? converted.sans.join(' ') : uci.join(' ');
}

/** Per-move eval-after text keyed by mainline ply id (fed to the move list). */
function storedEvalsByPly(
  mainline: readonly MovePly[],
  records: readonly MoveAnalysis[],
): ReadonlyMap<number, string> {
  const map = new Map<number, string>();
  records.forEach((record, ply) => {
    const node = mainline[ply];
    const white = node && evalAsWhite(record.evalAfter, record.side);
    if (node && white) {
      map.set(node.id, formatEvaluation(white));
    }
  });
  return map;
}

/** Mainline clocks keyed by ply id (mover's remaining time after the move). */
function clockMapForMainline(
  mainline: readonly MovePly[],
  clocks: readonly MoveClock[],
): ReadonlyMap<number, number> {
  const map = new Map<number, number>();
  for (const clock of clocks) {
    const node = mainline[clock.ply];
    if (node) {
      map.set(node.id, clock.clockMs);
    }
  }
  return map;
}

/**
 * Remaining clock for one colour at the position reached after `plies` plies:
 * the most recent `%clk` recorded for that colour among the plies played, or
 * the initial time-control base before either player has moved.
 */
function remainingClockForColor(
  plies: number,
  color: 'white' | 'black',
  clocks: readonly MoveClock[],
  fallbackMs: number | null,
): number | null {
  let bestPly = -1;
  let bestMs: number | null = null;
  for (const clock of clocks) {
    if (clock.color === color && clock.ply < plies && clock.ply > bestPly) {
      bestPly = clock.ply;
      bestMs = clock.clockMs;
    }
  }
  return bestPly >= 0 ? bestMs : fallbackMs;
}
