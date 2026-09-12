import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  buildTreeFromPgn,
  play as playMove,
  positionAtPath,
  pathToEnd,
  sideToMoveAt,
  step,
} from '@/components/chessboard/positionTree';
import type { MovePly, MoveTree, Path } from '@/components/chessboard/positionTree';
import { hasLegalMoves } from '@/components/chessboard/chessopsAdapter';
import { Chessboard, type ChessboardHandle } from '@/components/chessboard/Chessboard';
import { useBoardSize, type UseBoardSize } from '@/components/chessboard/useBoardSize';
import { BOARD_SIZE_DEFAULT } from '@/components/chessboard/boardSize';
import { SettingsPopover, type SettingsState } from '@/components/chessboard/SettingsPopover';
import { DEFAULT_BOARD_THEME, DEFAULT_PIECE_SET } from '@/components/chessboard/themes';
import { PromotionDialog, type PromotionRole } from '@/components/chessboard/PromotionDialog';
import { useBoardAppearance } from '@/hooks/useBoardAppearance';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { MoveList } from '@/components/chessboard/MoveList';
import { MoveListPane } from '@/components/chessboard/MoveListPane';
import { SquareBadges, type SquareBadgeItem } from '@/components/chessboard/SquareBadges';
import { nagMeta } from '@/components/chessboard/pgnAnnotations';
import { Navigation, type NavigationTarget } from '@/components/chessboard/Navigation';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import { formatEvaluation } from '@/components/analysis/engineFormat';
import { EvaluationBar } from '@/components/analysis/EvaluationBar';
import { AnalysisBoard } from '@/components/analysis/board/AnalysisBoard';
import { EvaluationDiagram } from '@/components/analysis/board/EvaluationDiagram';
import { engineArrowBrush, engineArrowShapes } from '@/components/analysis/engineArrows';
import { buildPlyEvaluations } from '@/components/analysis/moveEvals';
import { liveClassificationForTree } from '@/components/analysis/liveClassification';
import { useAnalysisController } from '@/components/analysis/useAnalysisController';
import { useBrowserAnalysisEngine } from '@/components/analysis/useBrowserAnalysisEngine';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import type { StoredPanelData } from '@/components/analysis/AnalysisPanel';
import { useEngineDefaults } from '@/hooks/useEngineDefaults';
import { useAnalysisNavigation } from '@/hooks/useAnalysisNavigation';
import { gameFromPgn } from '@/domain/chess/parseGame';
import { gameClocks, type MoveClock } from '@/domain/chess/clock';
import { parseTimeControl } from '@/domain/chess/timeControl';
import { fenOf, uciPvToSan } from '@/domain/chess';
import type { EvalCpMate, MoveAnalysis, MoveClassification, Wdl } from '@/domain/chess';
import { classifyMove, cpValueOf } from '@/domain/chess/classification';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATION_LABEL_TEXT,
  CLASSIFICATION_EXPLANATION,
  MISSED_TACTIC_NAG,
  formatAccuracy,
  missedTacticMeta,
  nagForClassification,
} from '@/domain/analysis/classificationMeta';
import { summarizeAnalysis } from '@/domain/analysis/summary';
import { isExclusiveMissedTactic } from '@/domain/analysis/effectiveClassification';
import { gameAccuracy } from '@/domain/analysis/accuracy';
import type { SummaryDetectionState } from '@/domain/analysis/summaryDerivation';
import { DETECTION_VERSION } from '@/domain/tactics';
import {
  classificationCountColor,
  missedTacticCountColor,
} from '@/components/analysis/classificationColors';
import type { AnalysisJob, GameAnalysisStatus } from '@/domain/analysis';
import { useGameReview } from '@/hooks/useGameReview';
import { useCloseInterruptGuard } from '@/hooks/useCloseInterruptGuard';
import { useGameAnalysis, type AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { useGameAnalysisSettings } from '@/hooks/useGameAnalysisSettings';
import { useTacticalDetectionSettings } from '@/hooks/useTacticalDetectionSettings';
import {
  defaultGameAnalysisSettings,
  expectedGameAnalysisConfig,
  gameAnalysisRunOf,
} from '@/components/analysis/gameAnalysisSettings';
import { getBrowserAnalysisService } from '@/infrastructure/analysis';
import { Button } from '@/components/ui/Button';
import styles from './GameReviewPage.module.css';
import './reviewBoardHighlights.css';

/** Player clock-bar height and the gap inside the board column (see css). */
const CLOCK_BAR_HEIGHT_PX = 34;
const BOARD_GAP_PX = 8;
/** Height added to the board column by the two player clock bars. */
const CLOCK_BAR_COLUMN_EXTRA_PX = CLOCK_BAR_HEIGHT_PX * 2 + BOARD_GAP_PX;
/**
 * Offset from the top of the board column to the top of the chessboard: the
 * evaluation bar must start at the board, not at the top clock bar.
 */
const CLOCK_BAR_TOP_INSET_PX = CLOCK_BAR_HEIGHT_PX + BOARD_GAP_PX;

interface GameReviewPageProps {
  /** Injectable for tests; defaults to the browser analysis service. */
  readonly analysisService?: AnalysisServiceLike | null;
}

/**
 * Classifications that warrant move-list NAGs/colours and board square
 * highlights in Game Review. `best`/`good` are intentionally *not* annotated:
 * the engine "best" label (NAG `!!`) is reserved for a future
 * great/brilliant-move detector, so ordinary strong play stays visually quiet
 * (D2/R2-3). `best` may still show a small board badge via
 * `classificationBoardBadges` — that is kept deliberately separate.
 */
const NEGATIVE_CLASSIFICATIONS: ReadonlySet<MoveClassification> = new Set([
  'inaccuracy',
  'mistake',
  'blunder',
]);

export function GameReviewPage({ analysisService }: GameReviewPageProps): React.JSX.Element {
  const { id = '' } = useParams<'id'>();
  const [builtService, setBuiltService] = useState<AnalysisServiceLike | null>(null);
  const data = useGameReview(id);
  const actions = useGameAnalysis(analysisService !== undefined ? analysisService : builtService);
  const [running, setRunning] = useState(false);
  const [serviceOutdated, setServiceOutdated] = useState(false);
  const effectiveService = analysisService !== undefined ? analysisService : builtService;
  // The current Game-analysis settings (profile + depth/search-time overrides).
  // Review (re-)analysis honours them exactly like Library bulk/per-row runs,
  // so a run started here is indistinguishable from one started there.
  const analysisSettings = useGameAnalysisSettings();
  // Current Stage-2 verification-depth setting (Feature 010 W2). A completed
  // current-version pass recorded at a different depth offers the explicit
  // "Re-scan tactics" action; changing the setting never auto-runs a scan.
  const tacticalSettings = useTacticalDetectionSettings();
  const currentVerificationDepth = tacticalSettings.settings?.verificationDepth ?? null;
  const runOptions = useMemo(() => {
    const settings = analysisSettings.settings ?? defaultGameAnalysisSettings();
    return gameAnalysisRunOf(settings);
  }, [analysisSettings.settings]);

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

  // The engine/settings-aware "outdated" flag (ADR-020 / §22) mirrors the Game
  // Library: a completed analysis produced before the current engine or under
  // an older Game-analysis configuration is offered an opt-in re-analysis.
  // Re-fetched whenever the shown job or the settings change.
  useEffect(() => {
    if (!effectiveService || !id) {
      return;
    }
    let active = true;
    const expected = analysisSettings.settings
      ? expectedGameAnalysisConfig(analysisSettings.settings)
      : undefined;
    effectiveService
      .statusesOf([id], expected)
      .then((statuses) => {
        if (active) {
          setServiceOutdated(statuses[id] === 'outdated');
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [effectiveService, id, data.job?.id, analysisSettings.settings]);

  const runAnalysis = (): void => {
    if (running || !id) {
      return;
    }
    setRunning(true);
    // The always-available Re-analyze is a forced re-run under the current
    // Game-analysis settings (Feature 008 §21); analyzing an unanalyzed game
    // is unaffected by `force`.
    void actions
      .analyze([id], runOptions.profile, true, runOptions.config)
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

  // Whether the shown analysis's Feature-010 detection pass is genuinely
  // running in this session. A persisted `queued`/`inProgress` summary only
  // means "scanning…" while the shared service reports it live; otherwise the
  // pass was interrupted (an earlier session / cancelled run) and the Review
  // says so instead of lying about a running scan.
  const [detectionRunning, setDetectionRunning] = useState(false);

  // While the detection pass for the shown analysis is pending, poll the live
  // registry: refresh so the missed-tactic row/marker appear the moment the
  // pass completes, and stop once nothing is running (an interrupted pass must
  // never cause endless reloads). Pure display work — never schedules scans.
  useEffect(() => {
    const pending = data.detectionState === 'queued' || data.detectionState === 'inProgress';
    if (!pending) {
      return;
    }
    let disposed = false;
    let checks = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const check = async (): Promise<void> => {
      checks += 1;
      let live = false;
      if (effectiveService && typeof effectiveService.activeDetectionGames === 'function') {
        try {
          live = (await effectiveService.activeDetectionGames()).includes(id);
        } catch {
          live = false;
        }
      }
      if (disposed) {
        return;
      }
      setDetectionRunning(live);
      if (live) {
        data.reload();
      } else if (checks >= 3) {
        // Nothing running across a few cycles: the pass is interrupted. Stop
        // polling — the note settles to the truthful interrupted state.
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      }
    };
    timer = setInterval(() => void check(), 2000);
    void check();
    return () => {
      disposed = true;
      if (timer !== null) {
        clearInterval(timer);
      }
    };
  }, [data.detectionState, effectiveService, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before the tab closes while the shown game is being analyzed or
  // scanned (engine work is resumable — leaving pauses it for later).
  useCloseInterruptGuard(
    data.status === 'queued' || data.status === 'inProgress' || running || detectionRunning,
    'Game analysis or a tactics scan is running for this game. Leaving now pauses it for later (resumable).',
  );

  if (data.loading) {
    return (
      <StatePanel title="Loading analysis…" description="Reading the stored game and analysis." />
    );
  }
  if (!data.game) {
    return <StatePanel title="Game not found" description="This game may have been deleted." />;
  }

  if (data.status === 'completed' && data.job && data.records.length > 0) {
    const detectionLive =
      (data.detectionState === 'queued' || data.detectionState === 'inProgress') &&
      detectionRunning;
    // A completed result produced by an older pipeline version is outdated
    // (plan 015 freshness gate): it is suppressed until a fresh scan re-runs.
    const detectionOutdated =
      data.detectionState === 'completed' && data.detectionVersion !== DETECTION_VERSION;
    // The completed pass is current (freshness reads `detectionVersion` alone)
    // but was produced at a different verification depth: the explicit
    // "Re-scan tactics" path applies the current setting (ADR-026/ADR-034).
    const depthStale =
      data.detectionState === 'completed' &&
      data.detectionVersion === DETECTION_VERSION &&
      currentVerificationDepth !== null &&
      data.verificationDepth !== null &&
      data.verificationDepth !== currentVerificationDepth;
    const scanActionKind =
      data.detectionState === 'queued' || data.detectionState === 'inProgress'
        ? detectionLive
          ? null
          : 'resume'
        : data.detectionState === 'failed'
          ? 'retry'
          : data.detectionState === 'absent'
            ? 'run'
            : detectionOutdated
              ? 'run'
              : null;
    return (
      <GameReview
        pgn={data.game.pgn}
        userColor={data.game.userColor}
        playerLabel={playerLabel(data.game)}
        records={data.records}
        obsolete={data.obsolete || serviceOutdated}
        detectionState={data.detectionState}
        detectionVersion={data.detectionVersion}
        detectionRunning={detectionRunning}
        scanProgress={data.scanProgress}
        scanActionKind={scanActionKind}
        depthStale={depthStale}
        scanAvailable={Boolean(effectiveService?.scanGame)}
        onScanAction={() => {
          if (!effectiveService?.scanGame || !id) {
            return;
          }
          void effectiveService
            .scanGame(id, depthStale ? { force: true } : undefined)
            .then(() => data.reload());
        }}
        onCancelScan={() => {
          if (!effectiveService?.cancelScan || !id) {
            return;
          }
          void effectiveService.cancelScan(id).then(() => data.reload());
        }}
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
      {...(data.status === 'queued' || data.status === 'inProgress'
        ? {
            cancelLabel: 'Cancel analysis',
            onCancel: () => {
              if (!effectiveService) {
                return;
              }
              void effectiveService.cancelGame(id).then(() => data.reload());
            },
          }
        : {})}
    />
  );
}

/**
 * Plan-013 W3: a compact numeric scan-progress readout shown inside the Review
 * scan bar while the pass is running — settled candidates over total, tinted in
 * the canonical missed-tactic magenta, with the numbers spelled out.
 */
function ScanProgressIndicator({
  progress,
}: {
  progress: { readonly done: number; readonly total: number };
}): React.JSX.Element {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <span
      className={styles.scanProgress}
      data-testid="review-scan-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Verifying tactic ${progress.done} of ${progress.total}, ${percent} per cent`}
    >
      <span className={styles.scanProgressTrack}>
        <span
          className={styles.scanProgressFill}
          style={{ width: `${percent}%` }}
          data-testid="review-scan-progress-fill"
        />
      </span>
      <span className={styles.scanProgressText} data-testid="review-scan-progress-text">
        Verifying tactic {progress.done} of {progress.total} · {percent}%
      </span>
    </span>
  );
}

function GameReview({
  pgn,
  userColor,
  playerLabel,
  records,
  obsolete,
  detectionState,
  detectionVersion,
  detectionRunning,
  scanProgress,
  scanActionKind,
  depthStale,
  scanAvailable,
  onScanAction,
  onCancelScan,
  onReanalyze,
  reanalyzing,
}: {
  pgn: string;
  userColor: 'white' | 'black';
  playerLabel: string;
  records: readonly MoveAnalysis[];
  obsolete: boolean;
  detectionState: SummaryDetectionState | null;
  /** Pipeline version of the shown result (plan 015); `null` pre-detection. */
  detectionVersion: number | null;
  /** True while this analysis's detection pass is live in this session. */
  detectionRunning: boolean;
  /**
   * Live Stage-2 scan progress (`done`/`total` settled candidates) of the shown
   * analysis's detection pass (plan 013 W3); `null` when none is recorded.
   */
  scanProgress: { readonly done: number; readonly total: number } | null;
  /** Which scan affordance applies for a non-live pass (`null` = none). */
  scanActionKind: 'resume' | 'retry' | 'run' | null;
  /**
   * True when a completed/current detection pass was produced at a verification
   * depth different from the current setting (Feature 010 W2): the explicit
   * "Re-scan tactics" affordance applies the current depth.
   */
  depthStale: boolean;
  /** Whether the shared service exposes the on-demand scan entry point. */
  scanAvailable: boolean;
  onScanAction: () => void;
  onCancelScan: () => void;
  onReanalyze: () => void;
  reanalyzing: boolean;
}): React.JSX.Element {
  const built = useMemo(() => buildTreeFromPgn(pgn), [pgn]);
  // The review tree is owned as state so the user can play exploration moves
  // that append variations/continuations to the move list. The persisted PGN
  // and its `MoveAnalysis` records are never mutated (ADR-033).
  const [tree, setTree] = useState<MoveTree | null>(built.error ? null : built.tree);
  const [path, setPath] = useState<Path>([]);
  const chessboardRef = useRef<ChessboardHandle | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  const boardSize = useBoardSize();
  const engine = useBrowserAnalysisEngine();
  const { defaults: engineDefaults, isReady: engineDefaultsReady } = useEngineDefaults();
  const [orientation, setOrientation] = useState<'white' | 'black'>(userColor);
  const [boardPrefs, setBoardPrefs] = useState<Omit<SettingsState, 'orientation'>>({
    coordinates: true,
    showLegalMoves: true,
    animation: true,
    drawable: true,
    interactive: true,
    boardTheme: DEFAULT_BOARD_THEME,
    pieceSet: DEFAULT_PIECE_SET,
  });
  const { defaults: boardAppearance, isReady: boardAppearanceReady } = useBoardAppearance();
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !boardAppearanceReady || !boardAppearance) {
        return;
      }
      setBoardPrefs((current) => ({
        ...current,
        boardTheme: boardAppearance.boardTheme,
        pieceSet: boardAppearance.pieceSet,
        coordinates: boardAppearance.coordinates,
        animation: boardAppearance.animation,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [boardAppearanceReady, boardAppearance]);
  const boardSettings: SettingsState = { ...boardPrefs, orientation };

  const handleBoardSettings = (next: SettingsState): void => {
    setOrientation(next.orientation);
    const { orientation: _o, ...rest } = next;
    setBoardPrefs(rest);
  };

  const mainline = useMemo(() => mainlineOf(tree), [tree]);
  const position = useMemo(() => (tree ? positionAtPath(tree, path) : null), [tree, path]);
  const finished = useMemo(() => {
    if (!position) {
      return true;
    }
    return (
      position.isCheckmate() ||
      position.isStalemate() ||
      position.isInsufficientMaterial() ||
      position.halfmoves >= 100 ||
      !hasLegalMoves(position)
    );
  }, [position]);
  const lastMove = useMemo(() => {
    const last = path[path.length - 1];
    if (!last) {
      return null;
    }
    const dest = plyDestSquare(last);
    return [last.from, dest ?? last.to] as readonly [Key, Key];
  }, [path]);
  const summary = useMemo(() => summarizeAnalysis(records, userColor), [records, userColor]);
  // ADR-024 per-game accuracy over the user's moves — and the opponent's — for
  // the two summary columns; `null` when no usable move exists (em-dash).
  const userAccuracy = useMemo(
    () => gameAccuracy(records, userColor).accuracy,
    [records, userColor],
  );
  const opponentAccuracy = useMemo(
    () => gameAccuracy(records, oppositeOf(userColor)).accuracy,
    [records, userColor],
  );
  const clocks = useMemo(() => {
    const parsed = gameFromPgn(pgn, { source: 'fixture', userColor });
    return parsed.ok ? gameClocks(parsed.game.moves) : [];
  }, [pgn, userColor]);
  const evalByPlyId = useMemo(() => storedEvalsByPly(mainline, records), [mainline, records]);
  const onMainlinePrefix = useMemo(() => isMainlinePrefix(path, mainline), [path, mainline]);

  const navigate = useCallback(
    (target: NavigationTarget): void => {
      setPendingPromotion(null);
      if (!tree) {
        return;
      }
      if (target === 'first') {
        setPath([]);
      } else if (target === 'last') {
        setPath((cur) => pathToEnd(tree, cur));
      } else {
        setPath((cur) => step(tree, cur, target === 'next' ? 1 : -1));
      }
    },
    [tree],
  );

  const handleSeek = useCallback((target: Path): void => {
    setPendingPromotion(null);
    setPath(target);
  }, []);

  // Interactive exploration: play any legal move on the review board. A move
  // that matches an existing continuation just navigates to it; anything else
  // is appended to the (transient) tree as a variation/continuation and shown
  // in the move list — never written to the stored game.
  const handleMove = useCallback(
    (from: string, to: string): void => {
      if (!tree || finished) {
        return;
      }
      const result = playMove(tree, path, from, to);
      if (result.error) {
        return;
      }
      setTree(result.tree);
      setPath(result.path);
    },
    [tree, path, finished],
  );

  const handlePromotionSelect = useCallback(
    (role: PromotionRole): void => {
      if (!tree || !pendingPromotion) {
        return;
      }
      const { from, to } = pendingPromotion;
      const result = playMove(tree, path, from, to, role);
      setPendingPromotion(null);
      requestAnimationFrame(() => chessboardRef.current?.clearPendingPromotion());
      if (result.error) {
        return;
      }
      setTree(result.tree);
      setPath(result.path);
    },
    [tree, path, pendingPromotion],
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
    const control = parseTimeControl(gameMeta.timeControl, 'generic');
    return control.baseSeconds !== null ? control.baseSeconds * 1000 : null;
  }, [gameMeta]);
  const topSide = oppositeOf(orientation);
  const nameOfSide = (side: 'white' | 'black'): string =>
    gameMeta === null
      ? side === userColor
        ? 'You'
        : 'Opponent'
      : side === 'white'
        ? gameMeta.whiteName
        : gameMeta.blackName;
  const opponentName = nameOfSide(topSide);
  const userName = nameOfSide(orientation);
  // Summary column headers always name the two colours by their stored player
  // (independent of the board orientation the user may have flipped to).
  const summaryUserLabel = nameOfSide(userColor);
  const summaryOpponentLabel = nameOfSide(oppositeOf(userColor));
  const opponentMs = remainingClockForColor(path.length, topSide, clocks, initialClockMs);
  const userMs = remainingClockForColor(path.length, orientation, clocks, initialClockMs);

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

  // Live engine: off = the analysis page shows the stored (cached) analysis
  // through the very same AnalysisPanel; toggling it on analyses the current
  // position live. One surface, one layout (ADR-033).
  const currentFen = useMemo(() => (position ? fenOf(position) : null), [position]);
  const sideToMove = useMemo(() => (tree ? sideToMoveAt(tree, path) : 'white'), [tree, path]);
  const controller = useAnalysisController({
    service: engine.service,
    fen: currentFen,
    capabilities: engine.capabilities,
    autoStart: false,
    defaults: engineDefaultsReady ? engineDefaults : null,
  });
  const live = controller.enabled;

  const activePly = path[path.length - 1];
  const activeMainIndex = activePly ? mainline.findIndex((node) => node.id === activePly.id) : -1;
  const selected = activeMainIndex >= 0 ? records[activeMainIndex] : undefined;

  // Stored evaluation shown on the bar: the evaluation of the currently
  // displayed position, re-expressed from that position's side-to-move
  // perspective (EvaluationBar contract).
  const barView = useMemo(() => {
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
  }, [path, onMainlinePrefix, activeMainIndex, records]);

  // Stored best-move arrows: the move that could have been played instead of
  // the selected move (coloured) plus the best move for the side to move.
  const storedArrows = useMemo<readonly DrawShape[]>(() => {
    if (!onMainlinePrefix) {
      return [];
    }
    const shapes: DrawShape[] = [];
    const selectedRecord = activeMainIndex >= 0 ? records[activeMainIndex] : undefined;
    const selectedUci =
      selectedRecord && selectedRecord.playedMove.uci !== selectedRecord?.bestMove?.uci
        ? selectedRecord.bestMove?.uci
        : undefined;
    if (selectedRecord && selectedUci) {
      shapes.push({
        orig: selectedUci.slice(0, 2) as Key,
        dest: selectedUci.slice(2, 4) as Key,
        brush: engineArrowBrush(0),
      });
    }
    const nextRecord = records[path.length];
    const nextUci = nextRecord?.bestMove?.uci ?? nextRecord?.bestPv[0];
    if (nextRecord && nextUci) {
      shapes.push({
        orig: nextUci.slice(0, 2) as Key,
        dest: nextUci.slice(2, 4) as Key,
        brush: selectedUci ? 'gray1' : engineArrowBrush(0),
      });
    }
    return shapes;
  }, [onMainlinePrefix, activeMainIndex, path, records]);

  // Cached data fed to the shared AnalysisPanel while the engine is off.
  const positionRecord = onMainlinePrefix ? records[path.length] : undefined;
  const storedPanel = useMemo<StoredPanelData>(() => {
    const engineLabel = records[0]
      ? `${records[0].engine.engineName} ${records[0].engine.engineVersion} · ${records[0].engine.profile}`
      : null;
    // Numeric eval text is White-positive (D1): flip the side-to-move
    // perspective of `barView` to White so the header agrees with the chips.
    const storedEval =
      barView.evaluation === null
        ? null
        : barView.sideToMove === 'black'
          ? negateEngineEval(barView.evaluation)
          : barView.evaluation;
    const headerEvalText = storedEval === null ? null : formatEvaluation(storedEval);
    const depth = positionRecord?.depth ?? null;
    const lines = positionRecord
      ? positionRecord.multipvLines.map((move) => ({
          evalText: evalText(move.evaluation, positionRecord.side),
          pvText: pvText(positionRecord.positionFen, move.uci),
        }))
      : [];
    return { engineLabel, evalText: headerEvalText, depth, lines };
  }, [records, positionRecord, barView]);

  const liveLines = controller.lines;
  const livePlyEvals = useMemo(
    () => (tree ? buildPlyEvaluations(tree, controller.evalsByFen) : new Map<number, string>()),
    [tree, controller.evalsByFen],
  );

  // The hook keeps the freshest engine lines per analysed FEN, so any ply whose
  // before/after positions were both analysed can be classified (ADR-023) and
  // surfaced with a glyph/highlight in the move list while the engine is live.
  const liveLinesByFen = controller.linesByFen;
  const liveClassificationByPly = useMemo(
    () =>
      tree && live
        ? liveClassificationForTree(tree, liveLinesByFen)
        : new Map<number, MoveClassification>(),
    [tree, live, liveLinesByFen],
  );

  // Ephemeral live classification of the selected (stored) move while the
  // engine runs: keep the stored before-context and substitute the live
  // post-move eval.
  const liveOverlay = useMemo(() => {
    if (!live || !selected || activePly === undefined) {
      return null;
    }
    const line = liveLines[0];
    if (!line) {
      return null;
    }
    const wdlAfter = line.wdl;
    const useWdl = wdlAfter !== null && selected.wdlBefore !== null;
    const classification = classifyMove({
      evalBefore: selected.evalBefore,
      evalAfter: negateCpMate(engineEvalToCpMate(line.evaluation)),
      bestMove: selected.bestMove,
      playedMove: selected.playedMove,
      legalMovesCount: selected.legalMovesCount,
      wdlBefore: useWdl ? selected.wdlBefore : null,
      wdlAfter: useWdl ? swapWdl(wdlAfter) : null,
      gamePhase: selected.gamePhase,
      inBook: false,
      topCpValues: selected.multipvLines.map((move) => cpValueOf(move.evaluation)),
    });
    return { classification, plyId: activePly.id };
  }, [live, selected, activePly, liveLines]);

  // Current-version verified-missed plies of the persisted analysis (Feature
  // 010), keyed the same way as `classificationByPly` (mainline node id) so the
  // extra marker NAG lands on the same move. Only flags written by the
  // **current** detection version render (plan 015 freshness gate): an outdated
  // pass's verdict is suppressed until a fresh scan re-runs it. These plies are
  // exclusive with the negative classification (ADR-023 amendment).
  const exclusiveMissedByPly = useMemo(() => {
    const ids = new Set<number>();
    mainline.forEach((node, ply) => {
      const record = records[ply];
      if (record && isExclusiveMissedTactic(record, DETECTION_VERSION)) {
        ids.add(node.id);
      }
    });
    return ids;
  }, [mainline, records]);

  // Single source of the classification displayed per ply: the persisted record
  // for each recorded mainline move, overridden by any live classification of
  // that ply (ephemeral engine results win while the engine is on) and by the
  // active-ply live overlay. A current-version verified missed-tactic ply is
  // exclusive (ADR-023 amendment): its classification entry is removed after
  // the merge so no glyph, chip or square highlight renders for it — only the
  // missed-tactic marker (below) remains.
  const classificationByPly = useMemo(() => {
    const map = new Map<number, MoveClassification>();
    mainline.forEach((node, ply) => {
      const record = records[ply];
      if (record) {
        map.set(node.id, record.classification);
      }
    });
    for (const [id, classification] of liveClassificationByPly) {
      map.set(id, classification);
    }
    if (liveOverlay) {
      map.set(liveOverlay.plyId, liveOverlay.classification);
    }
    for (const id of exclusiveMissedByPly) {
      map.delete(id);
    }
    return map;
  }, [mainline, records, liveClassificationByPly, liveOverlay, exclusiveMissedByPly]);

  // NAG overrides for the move list derive from that single map: only the
  // negative classifications render a glyph and its colour; `best`/`good`
  // plies override to no glyph (quiet by default, R2-3). An exclusive
  // missed-tactic ply renders **exactly one** annotation — the canonical marker
  // NAG (9) — and never a classification NAG alongside it.
  const effectiveNagOverrides = useMemo(() => {
    const map = new Map<number, readonly number[]>();
    for (const [id, classification] of classificationByPly) {
      const nag = NEGATIVE_CLASSIFICATIONS.has(classification)
        ? nagForClassification(classification)
        : null;
      map.set(id, nag === null ? [] : [nag]);
    }
    for (const id of exclusiveMissedByPly) {
      map.set(id, [MISSED_TACTIC_NAG]);
    }
    return map;
  }, [classificationByPly, exclusiveMissedByPly]);

  // Classification of the active (selected) ply for chips + square highlights.
  const activeClassification = useMemo<MoveClassification | undefined>(() => {
    if (activePly === undefined) {
      return undefined;
    }
    return classificationByPly.get(activePly.id);
  }, [activePly, classificationByPly]);

  // Board glyph chips (same style/formatting as the Playground): the active
  // ply's classification renders as a small badge on its destination square —
  // the king's landing square for a castling move (never for ordinary `good`
  // moves).
  const boardBadges = useMemo<readonly SquareBadgeItem[]>(
    () =>
      classificationBoardBadges({
        classification: activeClassification,
        square: activePly ? plyDestSquare(activePly) : undefined,
      }),
    [activePly, activeClassification],
  );

  // A negative classification also tints the move's start and end squares
  // with the classification colour (instead of the plain last-move highlight).
  // `best`/`good` moves keep only the plain last-move highlight (R2-3).
  const emphasizedSquares = useMemo<readonly [Key, Key] | null>(() => {
    if (activePly === undefined || !activeClassification) {
      return null;
    }
    if (!NEGATIVE_CLASSIFICATIONS.has(activeClassification)) {
      return null;
    }
    const dest = plyDestSquare(activePly);
    return [activePly.from, (dest ?? activePly.to) as Key] as readonly [Key, Key];
  }, [activePly, activeClassification]);

  const customSquareClasses = useMemo(() => {
    if (!emphasizedSquares || !activeClassification) {
      return undefined;
    }
    const cls = `review-cls-${activeClassification}`;
    return new Map<Key, string>([
      [emphasizedSquares[0], cls],
      [emphasizedSquares[1], cls],
    ]);
  }, [emphasizedSquares, activeClassification]);

  // Per-move evaluations: while the engine is live, freshly analysed plies
  // override their stored evaluation, but every other move keeps its stored
  // (persisted) value — toggling live analysis must not wipe the saved evals.
  const plyEvals = useMemo(() => {
    if (!live) {
      return evalByPlyId;
    }
    const merged = new Map<number, string>(evalByPlyId);
    for (const [id, text] of livePlyEvals) {
      merged.set(id, text);
    }
    return merged;
  }, [live, evalByPlyId, livePlyEvals]);

  const missedTacticMarker = missedTacticMeta();

  if (!tree || !position) {
    return (
      <StatePanel title="Cannot display game" description="The stored PGN could not be replayed." />
    );
  }

  const effectiveArrows = live
    ? engineArrowShapes(liveLines, controller.settings.arrows)
    : storedArrows;
  const barEvaluation = live
    ? liveLines.length > 0
      ? liveLines[0]!.evaluation
      : null
    : barView.evaluation;
  const barSideToMove = live ? sideToMove : barView.sideToMove;

  const currentPly = path.length;
  const totalPlies = pathToEnd(tree, []).length;

  // Detection derived state (Feature 010): a completed analysis that was never
  // scanned (or whose scan is pending/failed) is never presented as a real
  // zero — the summary shows either the scanned count or an explicit note, so
  // a game is never silently missing its missed-tactic result. A result
  // produced by an older pipeline version is outdated (plan 015): suppressed
  // until a fresh scan re-runs it.
  const detectionOutdated =
    detectionState === 'completed' && detectionVersion !== DETECTION_VERSION;
  const detectionCompleted =
    !detectionOutdated &&
    (detectionState === 'completed' ||
      records.some(
        (record) => record.missedTactic && record.detectionVersion === DETECTION_VERSION,
      ));
  const missedTacticsCount = detectionCompleted ? summary.userMissedTactics : null;
  const detectionNote = detectionOutdated
    ? 'The tactics scan used an older version. Run the scan to refresh it.'
    : detectionCompleted
      ? null
      : detectionState === 'queued' || detectionState === 'inProgress'
        ? detectionRunning
          ? 'Tactics scan in progress…'
          : 'Tactics scan interrupted. Resume the scan to continue.'
        : detectionState === 'failed'
          ? 'Tactics scan failed. Retry the scan.'
          : detectionState === 'absent'
            ? 'Tactics not scanned. Run the tactics scan.'
            : null;

  // A scan banner under the Review header (WP-B): a running scan is visible and
  // cancellable; an interrupted/failed/never-scanned analysis offers its
  // on-demand scan action. A completed/current pass offers nothing unless its
  // recorded verification depth differs from the current setting (W2), in
  // which case the explicit "Re-scan tactics" path applies the new depth.
  const scanScanning =
    (detectionState === 'queued' || detectionState === 'inProgress') && detectionRunning;
  const scanBar = scanScanning
    ? ({ kind: 'scanning' } as const)
    : depthStale && scanAvailable
      ? ({ kind: 'rescan' } as const)
      : detectionCompleted
        ? null
        : scanActionKind !== null && scanAvailable
          ? ({ kind: detectionOutdated ? 'refresh' : scanActionKind } as const)
          : null;
  const SCAN_BAR_COPY: Readonly<Record<string, { text: string; label: string }>> = {
    scanning: {
      text: 'Tactics scan in progress — analysing missed opportunities in this game.',
      label: 'Cancel scan',
    },
    resume: {
      text: 'Tactics scan interrupted. Continue it without re-analyzing the game.',
      label: 'Resume tactics scan',
    },
    retry: {
      text: 'The tactics scan failed. Retry just the scan.',
      label: 'Retry tactics scan',
    },
    run: {
      text: 'This analysis was never scanned for missed tactics.',
      label: 'Run tactics scan',
    },
    refresh: {
      text: 'The missed-tactic scan used an older version. Run the scan to refresh it.',
      label: 'Refresh tactics scan',
    },
    rescan: {
      text: 'This scan used a different verification depth. Re-scan to apply the current setting.',
      label: 'Re-scan tactics',
    },
  };

  // The move list / side-panel chrome spans the board column (board + its two
  // clock bars) so it keeps a stable, comparable height; the relocated Summary
  // sits below it, beside the evaluation diagram under the board (Q4 layout).
  const sidePanelBodyStyle = !boardSize.isMobile
    ? { height: boardSize.size + CLOCK_BAR_COLUMN_EXTRA_PX }
    : undefined;

  const seekDiagramPly = (ply: number): void => {
    handleSeek(mainline.slice(0, ply + 1));
  };

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
        </div>
        {obsolete ? (
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
        ) : (
          <Button
            variant="secondary"
            data-testid="review-reanalyze-action"
            disabled={reanalyzing}
            onClick={onReanalyze}
          >
            Re-analyze
          </Button>
        )}
      </header>

      {scanBar ? (
        <div className={styles.scanBar} data-testid="review-scan-bar" role="status">
          <span data-testid="review-scan-text">{SCAN_BAR_COPY[scanBar.kind]!.text}</span>
          {scanBar.kind === 'scanning' ? (
            <>
              {/* Plan-013 W3: numeric live progress (settled candidates over
                  total) in the distinct missed-tactic colour. */}
              {scanProgress && scanProgress.total > 0 ? (
                <ScanProgressIndicator progress={scanProgress} />
              ) : null}
              <Button variant="secondary" data-testid="review-scan-cancel" onClick={onCancelScan}>
                {SCAN_BAR_COPY.scanning!.label}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              data-testid={`review-scan-${scanBar.kind}`}
              onClick={onScanAction}
            >
              {SCAN_BAR_COPY[scanBar.kind]!.label}
            </Button>
          )}
        </div>
      ) : null}

      <AnalysisBoard
        boardSize={boardSize}
        dataTestId="review-layout"
        barOffsetPx={CLOCK_BAR_TOP_INSET_PX}
        boardColumn={
          <>
            <BoardPane
              boardSize={boardSize}
              position={position}
              settings={boardSettings}
              lastMove={emphasizedSquares ? null : lastMove}
              arrows={effectiveArrows}
              opponentName={opponentName}
              opponentMs={opponentMs}
              userName={userName}
              userMs={userMs}
              chessboardRef={chessboardRef}
              interactive={boardSettings.interactive}
              drawable={boardSettings.drawable}
              moving={pendingPromotion === null && !finished}
              onMove={handleMove}
              onPromotionRequired={(p) => setPendingPromotion(p)}
              {...(customSquareClasses !== undefined ? { customSquareClasses } : {})}
              overlay={
                boardBadges.length > 0 ? (
                  <SquareBadges orientation={orientation} items={boardBadges} />
                ) : undefined
              }
            />
            {/* Full-game evaluation diagram: one column per analyzed ply, at
                board width, below the bottom clock bar ("board footer"). */}
            <EvaluationDiagram
              records={records}
              activePly={activeMainIndex >= 0 ? activeMainIndex : null}
              onSeek={seekDiagramPly}
            />
          </>
        }
        bar={
          <EvaluationBar
            evaluation={barEvaluation}
            sideToMove={barSideToMove}
            orientation={boardSize.isMobile ? 'horizontal' : 'vertical'}
          />
        }
        sidePanel={
          <>
            <div className={styles.sidePanelBody} style={sidePanelBodyStyle}>
              <AnalysisPanel
                controller={controller}
                capabilities={engine.capabilities}
                fen={currentFen ?? ''}
                stored={storedPanel}
                rightSlot={
                  <SettingsPopover
                    state={boardSettings}
                    onChange={handleBoardSettings}
                    onResetBoardSize={() => boardSize.setSize(BOARD_SIZE_DEFAULT)}
                    onClearArrows={() => chessboardRef.current?.clearArrows()}
                    boardSize={boardSize.size}
                  />
                }
              />
              {selected &&
              selected.missedTactic &&
              selected.detectionVersion === DETECTION_VERSION ? (
                <div
                  className={styles.missed}
                  data-testid="review-missed-tactic-label"
                  role="note"
                  title={missedTacticMarker.explanation}
                  aria-label={missedTacticMarker.explanation}
                >
                  {missedTacticMarker.label}
                </div>
              ) : null}
              <MoveListPane>
                <MoveList
                  tree={tree}
                  path={path}
                  onSeek={handleSeek}
                  nagOverrides={effectiveNagOverrides}
                  plyEvals={plyEvals}
                />
              </MoveListPane>
              <div className={styles.navRow}>
                <Navigation currentPly={currentPly} totalPlies={totalPlies} onNavigate={navigate} />
                <span className={styles.plyCounter} data-testid="review-ply">
                  {currentPly}/{totalPlies}
                </span>
              </div>
            </div>
            <ReviewSummary
              summary={summary}
              userAccuracy={userAccuracy}
              opponentAccuracy={opponentAccuracy}
              userLabel={summaryUserLabel}
              opponentLabel={summaryOpponentLabel}
              missedTactics={missedTacticsCount}
              detectionNote={detectionNote}
            />
          </>
        }
      />

      <PromotionDialog
        open={pendingPromotion !== null}
        pieceSet={boardSettings.pieceSet}
        onSelect={handlePromotionSelect}
        onCancel={handlePromotionCancel}
      />
    </div>
  );
}

/** Shared board column of both Review modes: clock bars around the board. */
function BoardPane({
  boardSize,
  position,
  settings,
  lastMove,
  arrows,
  opponentName,
  opponentMs,
  userName,
  userMs,
  overlay,
  chessboardRef,
  interactive,
  drawable,
  moving,
  onMove,
  onPromotionRequired,
  customSquareClasses,
}: {
  boardSize: UseBoardSize;
  position: ReturnType<typeof positionAtPath>;
  settings: SettingsState;
  lastMove: readonly [Key, Key] | null;
  arrows: readonly DrawShape[];
  opponentName: string;
  opponentMs: number | null;
  userName: string;
  userMs: number | null;
  /** Optional board overlay (classification/NAG chips). */
  overlay?: React.ReactNode;
  /** Chessboard handle (clear arrows / promotions). */
  chessboardRef: React.RefObject<ChessboardHandle | null>;
  interactive: boolean;
  drawable: boolean;
  moving: boolean;
  onMove: (from: string, to: string) => void;
  onPromotionRequired: (pending: { from: string; to: string }) => void;
  /** Classification-colored start/end-square highlight classes. */
  customSquareClasses?: ReadonlyMap<Key, string>;
}): React.JSX.Element {
  return (
    <div className={styles.boardStack}>
      <ClockBar name={opponentName} timeMs={opponentMs} dataTestId="review-clock-opponent" />
      <Chessboard
        ref={chessboardRef}
        position={position}
        interactive={interactive}
        drawable={drawable}
        moving={moving}
        orientation={settings.orientation}
        coordinates={settings.coordinates}
        showLegalMoves={settings.showLegalMoves}
        animation={settings.animation}
        boardTheme={settings.boardTheme}
        pieceSet={settings.pieceSet}
        lastMove={lastMove}
        autoShapes={arrows}
        boardSize={boardSize}
        onMove={onMove}
        onPromotionRequired={onPromotionRequired}
        {...(customSquareClasses !== undefined ? { customSquareClasses } : {})}
        {...(overlay !== undefined ? { overlay } : {})}
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

function ReviewSummary({
  summary,
  userAccuracy,
  opponentAccuracy,
  userLabel,
  opponentLabel,
  missedTactics,
  detectionNote,
}: {
  summary: ReturnType<typeof summarizeAnalysis>;
  userAccuracy: number | null;
  opponentAccuracy: number | null;
  userLabel: string;
  opponentLabel: string;
  /** Missed-tactic count; `null` hides the row (scan absent/not completed). */
  missedTactics: number | null;
  /** Visible detection-state note when the scan has not completed; else null. */
  detectionNote: string | null;
}): React.JSX.Element {
  return (
    <section className={styles.summary} data-testid="review-summary" aria-label="Review summary">
      <div
        className={styles.summaryTable}
        role="table"
        aria-label="Review statistics per player: accuracy, best moves, good moves, inaccuracies, mistakes, blunders and missed tactics"
      >
        <div className={styles.summaryHead} role="row">
          <span
            role="columnheader"
            className={styles.summaryColHead}
            data-testid="summary-user-head"
          >
            {userLabel}
          </span>
          <span role="columnheader" className={styles.summaryRowLabel} aria-hidden="true" />
          <span
            role="columnheader"
            className={styles.summaryColHead}
            data-testid="summary-opponent-head"
          >
            {opponentLabel}
          </span>
        </div>

        {/* Accuracy row: each side's own figure — a stat like the rest, only a
            little larger; never a full-width headline. */}
        <div
          className={styles.summaryRow}
          role="row"
          aria-label={`Accuracy: you ${formatAccuracy(userAccuracy)} per cent, ${opponentLabel} ${formatAccuracy(opponentAccuracy)} per cent`}
        >
          <span
            role="cell"
            className={`${styles.summaryValue} ${styles.summaryAccuracyValue}`}
            data-testid="summary-accuracy-user"
          >
            {formatAccuracy(userAccuracy)}%
          </span>
          <span role="cell" className={styles.summaryRowLabel}>
            Accuracy
          </span>
          <span
            role="cell"
            className={`${styles.summaryValue} ${styles.summaryAccuracyValue}`}
            data-testid="summary-accuracy-opponent"
          >
            {formatAccuracy(opponentAccuracy)}%
          </span>
        </div>

        {CLASSIFICATION_LABELS.map((classification) => {
          const userCount = summary.user[classification];
          const opponentCount = summary.opponent[classification];
          const explanation = CLASSIFICATION_EXPLANATION[classification];
          return (
            <div
              className={styles.summaryRow}
              role="row"
              key={classification}
              title={explanation}
              aria-label={`${CLASSIFICATION_LABEL_TEXT[classification]}: you ${userCount}, ${opponentLabel} ${opponentCount}. ${explanation}`}
            >
              <span
                role="cell"
                className={styles.summaryValue}
                data-testid={`summary-user-${classification}-value`}
                style={{ color: classificationCountColor(classification, userCount) }}
              >
                {userCount}
              </span>
              <span role="cell" className={styles.summaryRowLabel}>
                {CLASSIFICATION_LABEL_TEXT[classification]}
              </span>
              <span
                role="cell"
                className={styles.summaryValue}
                data-testid={`summary-opponent-${classification}-value`}
                style={{ color: classificationCountColor(classification, opponentCount) }}
              >
                {opponentCount}
              </span>
            </div>
          );
        })}

        {missedTactics !== null ? (
          <div
            className={styles.summaryRow}
            role="row"
            aria-label={`Missed tactics: you ${missedTactics}`}
          >
            <span
              role="cell"
              className={styles.summaryValue}
              data-testid="summary-missed-tactics-value"
              style={{ color: missedTacticCountColor(missedTactics) }}
            >
              {missedTactics}
            </span>
            <span role="cell" className={styles.summaryRowLabel}>
              Missed tactics
            </span>
            <span role="cell" className={styles.summaryValue} aria-hidden="true" />
          </div>
        ) : null}
      </div>
      {detectionNote !== null ? (
        <p className={styles.detectionNote} data-testid="review-detection-state" role="status">
          {detectionNote}
        </p>
      ) : null}
    </section>
  );
}

function StatePanel({
  title,
  description,
  actionLabel,
  actionDisabled,
  onAction,
  cancelLabel,
  onCancel,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
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
        {cancelLabel && onCancel ? (
          <Button
            variant="secondary"
            data-testid="review-cancel-action"
            disabled={actionDisabled}
            onClick={onCancel}
          >
            {cancelLabel}
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

/**
 * Board glyph chips for one ply: a classification that is visually
 * emphasized (every state except ordinary `good`) becomes a small NAG badge
 * on the move's destination square — the same SquareBadges chips the
 * Playground uses. `null`/ordinary classifications render nothing.
 */
/** Best-move board marker: a quiet star. `!!` (NAG 3) stays reserved for a
 * future great/brilliant-move detector, so engine-best moves are not shown
 * with an exaggerated "brilliant" glyph on the board either. */
const BEST_MOVE_MARK = '★';
const BEST_MOVE_MARK_COLOR = '#15781b';

/**
 * Destination square used for a ply's board badge / highlights. For a
 * castling move the badge belongs on the square the **king** lands on
 * (g1/g8 for O-O, c1/c8 for O-O-O), never on the rook's starting square.
 * Accepts a structural ply subset so it is trivially unit-testable.
 */
export function plyDestSquare(
  ply: { readonly san: string; readonly color: 'white' | 'black'; readonly to: string } | undefined,
): string | undefined {
  if (!ply) {
    return undefined;
  }
  if (ply.san === 'O-O') {
    return ply.color === 'white' ? 'g1' : 'g8';
  }
  if (ply.san === 'O-O-O') {
    return ply.color === 'white' ? 'c1' : 'c8';
  }
  return ply.to;
}

export function classificationBoardBadges(input: {
  classification: MoveClassification | null | undefined;
  square: string | undefined;
}): readonly SquareBadgeItem[] {
  const { classification, square } = input;
  if (!classification || !square) {
    return [];
  }
  // The engine-best label gets a quiet star, never `!!` (reserved).
  if (classification === 'best') {
    return [
      {
        square,
        text: BEST_MOVE_MARK,
        color: BEST_MOVE_MARK_COLOR,
        kind: 'nag',
        testId: 'nag-badge',
      },
    ];
  }
  const nag = nagForClassification(classification);
  if (nag === null) {
    return [];
  }
  const meta = nagMeta(nag);
  if (!meta) {
    return [];
  }
  return [{ square, text: meta.glyph, color: meta.color, kind: 'nag', testId: 'nag-badge' }];
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
