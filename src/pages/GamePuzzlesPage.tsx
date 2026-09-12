import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { Chessboard } from '@/components/chessboard/Chessboard';
import { uciMoveArrow } from '@/components/chessboard/boardShapes';
import { useBoardSize, type UseBoardSize } from '@/components/chessboard/useBoardSize';
import { Button } from '@/components/ui/Button';
import { parsePositionFen, uciPvToSan } from '@/domain/chess';
import type { Position } from '@/domain/chess';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import {
  analysisStatusOf,
  latestCompletedJob,
  type AnalysisJob,
  type GameAnalysisStatus,
} from '@/domain/analysis';
import type {
  SummaryDetectionState,
  SummaryPuzzleState,
} from '@/domain/analysis/summaryDerivation';
import {
  difficultyBucketOf,
  PUZZLE_GENERATOR_VERSION,
  puzzleObjectiveLabel,
} from '@/domain/puzzle';
import type { PuzzleRow } from '@/domain/puzzle';
import { DETECTION_VERSION } from '@/domain/tactics';
import { ROUTES } from '@/app/routes';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { analysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { getBrowserAnalysisService } from '@/infrastructure/analysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import styles from './GamePuzzlesPage.module.css';

interface GamePuzzlesPageProps {
  /** Injectable for tests; defaults to the browser analysis service. */
  readonly analysisService?: AnalysisServiceLike | null;
}

interface PuzzlesData {
  readonly loading: boolean;
  readonly game: GameLike | null;
  /** Completed job backing the shown analysis, if any. */
  readonly job: AnalysisJob | null;
  readonly status: GameAnalysisStatus | null;
  /**
   * Feature-010 detection-pass state of the shown analysis; `'absent'` when
   * the run has no summary row yet (older analyses pre-date the summary
   * table). Only a completed, current-version pass enables puzzle generation.
   */
  readonly detectionState: SummaryDetectionState | null;
  readonly detectionVersion: number | null;
  /**
   * Feature-011 puzzle-generation state of the shown analysis (`'absent'` =
   * no generation pass exists yet — never a real zero).
   */
  readonly puzzleState: SummaryPuzzleState;
  /**
   * Puzzle-generator version of the shown analysis's completed generation pass;
   * `null` until a pass completes. A completed pass whose version differs from
   * the current `PUZZLE_GENERATOR_VERSION` is outdated → Regenerate is offered.
   */
  readonly puzzleGeneratorVersion: number | null;
  /** Live generation progress (`done`/`total` puzzles settled); `null` pre-pass. */
  readonly puzzleProgress: { readonly done: number; readonly total: number } | null;
  /** Every puzzle row of the game (game-scoped immutable rows), ply-ordered. */
  readonly puzzles: readonly PuzzleRow[];
  reload(): void;
}

/** Structural subset of `Game` the page renders (players, result, source). */
interface GameLike {
  readonly whitePlayer: { readonly name: string };
  readonly blackPlayer: { readonly name: string };
  readonly result: string;
  readonly source: keyof typeof GAME_SOURCE_LABELS;
}

/**
 * Loads the per-game puzzle view state for one game: the game, its latest
 * completed analysis's detection/generation summary (Feature 010/011), and the
 * game's persisted puzzle rows. Pure read of IndexedDB — no engine, no cache.
 */
function useGamePuzzles(gameId: string): PuzzlesData {
  const [state, setState] = useState<Omit<PuzzlesData, 'reload'>>({
    loading: true,
    game: null,
    job: null,
    status: null,
    detectionState: 'absent',
    detectionVersion: null,
    puzzleState: 'absent',
    puzzleGeneratorVersion: null,
    puzzleProgress: null,
    puzzles: [],
  });

  const load = useCallback(() => {
    let cancelled = false;
    void (async () => {
      const game = await gamesRepository.getGame(gameId);
      const jobs = game ? await analysisJobsRepository.listByGame(gameId) : [];
      const status = game ? analysisStatusOf(jobs) : null;
      const completed = latestCompletedJob(jobs);
      let detectionState: PuzzlesData['detectionState'] = 'absent';
      let detectionVersion: number | null = null;
      let puzzleState: SummaryPuzzleState = 'absent';
      let puzzleGeneratorVersion: number | null = null;
      let puzzleProgress: PuzzlesData['puzzleProgress'] = null;
      if (game && completed) {
        const summary = await summariesRepository.getForAnalysis(completed.id);
        // `absent` (older analyses that predate the summary table) is a real
        // state: generation never ran, and puzzles were never generated.
        detectionState = summary ? summary.detectionState : 'absent';
        detectionVersion = summary?.detectionVersion ?? null;
        puzzleState = summary?.puzzleState ?? 'absent';
        puzzleGeneratorVersion = summary?.puzzleGeneratorVersion ?? null;
        puzzleProgress = summary?.puzzleProgress ?? null;
      }
      if (cancelled) {
        return;
      }
      const puzzles = game ? await puzzlesRepository.listForGame(gameId) : [];
      if (cancelled) {
        return;
      }
      setState({
        loading: false,
        game: game ?? null,
        job: completed ?? null,
        status: game ? status : null,
        detectionState,
        detectionVersion,
        puzzleState,
        puzzleGeneratorVersion,
        puzzleProgress,
        puzzles,
      });
    })().catch(() => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, loading: false, game: null, status: null, puzzles: [] }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    const dispose = load();
    return dispose;
  }, [load]);

  return { ...state, reload: load };
}

/** Full-move number of a 0-based ply (`0`/`1` → move 1, `2`/`3` → move 2). */
function fullMoveOf(ply: number): number {
  return Math.floor(ply / 2) + 1;
}

/** UCI move list → SAN from a FEN; falls back to the raw UCI on any error. */
function sanText(fen: string, uci: readonly string[]): string {
  if (uci.length === 0) {
    return '';
  }
  const converted = uciPvToSan(fen, [...uci]);
  return converted.ok ? converted.sans.join(' ') : uci.join(' ');
}

function GamePuzzlesPage({ analysisService }: GamePuzzlesPageProps): React.JSX.Element {
  const { id = '' } = useParams<'id'>();
  const [builtService, setBuiltService] = useState<AnalysisServiceLike | null>(null);
  const data = useGamePuzzles(id);
  const [starting, setStarting] = useState(false);
  const boardSize = useBoardSize();
  const effectiveService = analysisService !== undefined ? analysisService : builtService;
  const [running, setRunning] = useState<{ detection: boolean; generation: boolean }>({
    detection: false,
    generation: false,
  });

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

  const generationPending = data.puzzleState === 'queued' || data.puzzleState === 'inProgress';
  const detectionPending = data.detectionState === 'queued' || data.detectionState === 'inProgress';

  // While a generation pass or a detection pass for the shown analysis is
  // pending, poll the shared live registries: refresh so the puzzle rows /
  // state line settle the moment a live pass completes, and stop once nothing
  // is running (an interrupted pass must never cause endless reloads). Pure
  // display work — never schedules scans or generation.
  useEffect(() => {
    const pending = generationPending || detectionPending;
    if (!pending) {
      return;
    }
    let disposed = false;
    let checks = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let wasGenerationLive = false;
    let wasDetectionLive = false;
    const check = async (): Promise<void> => {
      checks += 1;
      let generationLive = false;
      let detectionLive = false;
      if (effectiveService && typeof effectiveService.activeGenerationGames === 'function') {
        try {
          generationLive = (await effectiveService.activeGenerationGames()).has(id);
        } catch {
          generationLive = false;
        }
      }
      if (effectiveService && typeof effectiveService.activeDetectionGames === 'function') {
        try {
          detectionLive = (await effectiveService.activeDetectionGames()).includes(id);
        } catch {
          detectionLive = false;
        }
      }
      if (disposed) {
        return;
      }
      // A pass that was live and is no longer live just settled (or was
      // interrupted mid-session): reload once so the real state appears.
      if ((wasGenerationLive && !generationLive) || (wasDetectionLive && !detectionLive)) {
        data.reload();
      }
      wasGenerationLive = generationLive;
      wasDetectionLive = detectionLive;
      setRunning((current) =>
        current.detection === detectionLive && current.generation === generationLive
          ? current
          : { detection: detectionLive, generation: generationLive },
      );
      if (generationLive || detectionLive) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveService, id, generationPending, detectionPending]);

  const runGeneration = (): void => {
    if (starting || !id || !effectiveService?.generatePuzzles) {
      return;
    }
    setStarting(true);
    void effectiveService
      .generatePuzzles(id)
      .then((outcome) => {
        if (outcome === 'started') {
          // Optimistic live registry: the state line reads "generating" until
          // the poll observes the real registry/persisted progress.
          setRunning((current) => ({ ...current, generation: true }));
        }
        data.reload();
      })
      .catch(() => undefined)
      .finally(() => {
        setStarting(false);
      });
  };

  if (data.loading) {
    return (
      <PuzzlesStatePanel
        dataTestId="puzzles-page"
        title="Loading puzzles…"
        description="Reading the stored game and its puzzles."
      />
    );
  }
  if (!data.game) {
    return (
      <PuzzlesStatePanel
        dataTestId="puzzles-page"
        title="Game not found"
        description="This game may have been deleted."
      />
    );
  }
  if (data.status !== 'completed' || !data.job) {
    return (
      <PuzzlesStatePanel
        dataTestId="puzzles-page"
        title={statusTitle(data.status)}
        description={statusDescription(data.status)}
      />
    );
  }

  // R-6 stale-detection gate (plan 015 freshness): a completed detection
  // produced by an older DETECTION_VERSION is outdated — its puzzle state/count
  // is suppressed with the out-of-date note, but the immutable puzzle rows stay
  // inspectable.
  const detectionOutdated =
    data.detectionState === 'completed' && data.detectionVersion !== DETECTION_VERSION;
  const detectionReady = data.detectionState === 'completed' && !detectionOutdated;
  const generationLive = generationPending && running.generation;

  const { note, regenerateNote, actionKind } = puzzleHeaderUi({
    detectionOutdated,
    detectionReady,
    puzzleState: data.puzzleState,
    puzzleProgress: data.puzzleProgress,
    puzzleGeneratorVersion: data.puzzleGeneratorVersion,
    generationLive,
    count: data.puzzles.length,
  });
  const canGenerate =
    effectiveService !== null && typeof effectiveService.generatePuzzles === 'function';

  return (
    <div className={styles.page} data-testid="puzzles-page">
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} data-testid="puzzles-back" to="/games">
            ← Game Library
          </Link>
          <h1 className={styles.heading}>Puzzles</h1>
          <p className={styles.subtitle} data-testid="puzzles-game-label">
            {playerLabel(data.game)}
          </p>
        </div>
        <Link
          className={styles.createSetLink}
          to={`${ROUTES.trainingNew}?source=game&gameId=${encodeURIComponent(id)}`}
          data-testid="puzzles-create-set"
        >
          Create training set
        </Link>
      </header>

      <div className={styles.stateBar} data-testid="puzzles-state-bar" role="status">
        <span data-testid="puzzles-state-note">
          {note}
          {regenerateNote !== null ? (
            <span className={styles.regenerateNote} data-testid="puzzles-regenerate-note">
              {' '}
              · {regenerateNote}
            </span>
          ) : null}
        </span>
        {actionKind !== null && canGenerate && !generationLive ? (
          <Button
            variant="secondary"
            data-testid={`puzzles-${actionKind}`}
            disabled={starting}
            onClick={runGeneration}
          >
            {ACTION_LABELS[actionKind]}
          </Button>
        ) : null}
      </div>

      {data.puzzles.length > 0 ? (
        <section
          className={styles.cards}
          data-testid="puzzles-list"
          aria-label={`${data.puzzles.length} ${data.puzzles.length === 1 ? 'puzzle' : 'puzzles'} from this game`}
        >
          {[...data.puzzles]
            .sort((a, b) => a.sourcePly - b.sourcePly)
            .map((row) => (
              <PuzzleCard key={row.sourcePly} row={row} boardSize={boardSize} />
            ))}
        </section>
      ) : data.puzzleState === 'completed' && detectionReady ? (
        <p className={styles.empty} data-testid="puzzles-empty">
          No puzzles were generated for this game.
        </p>
      ) : null}
    </div>
  );
}

/** Generation state line + which on-demand affordance applies (if any). */
function puzzleHeaderUi(input: {
  readonly detectionOutdated: boolean;
  readonly detectionReady: boolean;
  readonly puzzleState: SummaryPuzzleState;
  readonly puzzleProgress: { readonly done: number; readonly total: number } | null;
  readonly puzzleGeneratorVersion: number | null;
  readonly generationLive: boolean;
  readonly count: number;
}): {
  note: string;
  regenerateNote: string | null;
  actionKind: 'generate' | 'resume' | 'retry' | 'regenerate' | null;
} {
  if (input.detectionOutdated) {
    return {
      note: 'The tactics scan used an older version — puzzle state is out of date until the scan is refreshed.',
      regenerateNote: null,
      actionKind: null,
    };
  }
  if (!input.detectionReady) {
    return {
      note: 'Tactics scan must complete before puzzles are generated.',
      regenerateNote: null,
      actionKind: null,
    };
  }
  const puzzle = input.puzzleState;
  if (input.generationLive) {
    const progress = input.puzzleProgress;
    return {
      note:
        progress && progress.total > 0
          ? `Generating puzzle ${progress.done} of ${progress.total}…`
          : 'Generating puzzles…',
      regenerateNote: null,
      actionKind: null,
    };
  }
  if (puzzle === 'completed') {
    const countNote = `${input.count} ${input.count === 1 ? 'puzzle' : 'puzzles'}`;
    if (input.puzzleGeneratorVersion === PUZZLE_GENERATOR_VERSION) {
      return { note: countNote, regenerateNote: null, actionKind: null };
    }
    // A completed pass from an older generator version is outdated: the rows
    // stay inspectable and the header offers an engine-free Regenerate.
    return {
      note: countNote,
      regenerateNote:
        'Puzzle generation is from an older generator — regenerate to add one-move blunder puzzles.',
      actionKind: 'regenerate',
    };
  }
  if (puzzle === 'absent') {
    return { note: 'Puzzles not generated', regenerateNote: null, actionKind: 'generate' };
  }
  if (puzzle === 'queued' || puzzle === 'inProgress') {
    return { note: 'Puzzle generation interrupted', regenerateNote: null, actionKind: 'resume' };
  }
  if (puzzle === 'failed') {
    return { note: 'Puzzle generation failed', regenerateNote: null, actionKind: 'retry' };
  }
  return { note: 'Puzzles not generated', regenerateNote: null, actionKind: null };
}

const ACTION_LABELS: Readonly<Record<'generate' | 'resume' | 'retry' | 'regenerate', string>> = {
  generate: 'Generate puzzles',
  resume: 'Resume puzzle generation',
  retry: 'Retry puzzle generation',
  regenerate: 'Regenerate puzzles',
};

/**
 * One read-only puzzle card: the starting position on the shared board (pieces
 * frozen, free-draw enabled for inspection, oriented to the side to move), the
 * ADR-025 difficulty bucket + score, the objective, and the provenance. The
 * solution is hidden behind a per-card "Show solution" reveal (SAN + the green
 * solution arrow); the user's actual move is always shown as a red arrow and
 * as text. No solving, no hints, no attempt recording (Feature 012).
 */
function PuzzleCard({
  row,
  boardSize,
}: {
  row: PuzzleRow;
  boardSize: UseBoardSize;
}): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const position = useMemo<Position | null>(() => {
    const parsed = parsePositionFen(row.startingFen);
    return parsed.ok ? parsed.position : null;
  }, [row.startingFen]);
  const bucket = difficultyBucketOf(row.difficulty);
  const objective = puzzleObjectiveLabel(row);
  const played = sanText(row.startingFen, [row.userMovePlayed]);
  const solution = sanText(row.startingFen, [...row.bestPv]);
  // Accepted alternative first moves beyond the best move, as SAN (a move that
  // is not accepted is incorrect — Feature 012/013 contract). Tactical rows
  // only; blunder rows have none.
  const alternatives = useMemo(() => {
    const distinct = [...new Set(row.acceptedFirstMoves ?? [])];
    if (distinct.length <= 1) {
      return [];
    }
    return distinct
      .filter((uci) => uci !== row.bestMove)
      .map((uci) => sanText(row.startingFen, [uci]));
  }, [row]);
  const moveNumber = fullMoveOf(row.sourcePly);
  // Board arrows: the user's actual (wrong) move is always marked red; the
  // solution's first move is drawn green only after the solution is revealed.
  const autoShapes = useMemo<readonly DrawShape[]>(() => {
    const shapes: DrawShape[] = [];
    const playedArrow = uciMoveArrow(row.userMovePlayed, 'red');
    if (playedArrow) {
      shapes.push(playedArrow);
    }
    if (revealed) {
      const solutionArrow = uciMoveArrow(row.bestMove, 'green');
      if (solutionArrow) {
        shapes.push(solutionArrow);
      }
    }
    return shapes;
  }, [row.userMovePlayed, row.bestMove, revealed]);

  return (
    <article
      className={styles.card}
      data-testid={`puzzle-card-${row.sourcePly}`}
      role="region"
      aria-label={`Puzzle at move ${moveNumber}, ply ${row.sourcePly}. ${bucket.name} difficulty, ${bucket.min} to ${bucket.max}. ${objective}. You played ${played}.${
        revealed ? ` Solution ${solution}.` : ''
      }`}
    >
      <div className={styles.boardArea} data-testid={`puzzle-board-${row.sourcePly}`}>
        {position ? (
          <Chessboard
            position={position}
            interactive={false}
            orientation={row.sideToMove}
            drawable
            autoShapes={autoShapes}
            boardSize={boardSize}
          />
        ) : (
          <p
            className={styles.positionMissing}
            data-testid={`puzzle-position-missing-${row.sourcePly}`}
          >
            Starting position unavailable.
          </p>
        )}
      </div>
      <div className={styles.meta}>
        <dl className={styles.facts}>
          <div className={styles.factRow}>
            <dt>Difficulty</dt>
            <dd data-testid={`puzzle-difficulty-${row.sourcePly}`}>
              {bucket.name} · {row.difficulty}
            </dd>
          </div>
          <div className={styles.factRow}>
            <dt>Objective</dt>
            <dd data-testid={`puzzle-objective-${row.sourcePly}`}>{objective}</dd>
          </div>
        </dl>
        <p className={styles.provenance} data-testid={`puzzle-provenance-${row.sourcePly}`}>
          Move {moveNumber} (ply {row.sourcePly})
        </p>
        <p className={styles.played} data-testid={`puzzle-played-${row.sourcePly}`}>
          You played <strong>{played}</strong>
        </p>
        <Button
          variant="secondary"
          className={styles.reveal!}
          data-testid={`puzzle-reveal-${row.sourcePly}`}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide solution' : 'Show solution'}
          onClick={() => setRevealed((cur) => !cur)}
        >
          {revealed ? 'Hide solution' : 'Show solution'}
        </Button>
        {revealed ? (
          <>
            <p className={styles.solution} data-testid={`puzzle-solution-${row.sourcePly}`}>
              Solution <strong>{solution}</strong>
            </p>
            {alternatives.length > 0 ? (
              <p className={styles.alternatives} data-testid={`puzzle-accepted-${row.sourcePly}`}>
                Also accepted:{' '}
                {alternatives.map((san) => (
                  <span key={san} className={styles.acceptedChip}>
                    {san}
                  </span>
                ))}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

function PuzzlesStatePanel({
  dataTestId,
  title,
  description,
}: {
  dataTestId: string;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className={styles.page} data-testid={dataTestId}>
      <Link className={styles.backLink} data-testid="puzzles-back" to="/games">
        ← Game Library
      </Link>
      <section className={styles.statePanel}>
        <h1 className={styles.stateTitle}>{title}</h1>
        <p className={styles.stateDescription}>{description}</p>
      </section>
    </div>
  );
}

function statusTitle(status: GameAnalysisStatus | null): string {
  switch (status) {
    case 'queued':
      return 'Analysis queued';
    case 'inProgress':
      return 'Analysis in progress';
    case 'failed':
      return 'Analysis failed';
    case 'cancelled':
      return 'Analysis cancelled';
    default:
      return 'No analysis yet';
  }
}

function statusDescription(status: GameAnalysisStatus | null): string {
  switch (status) {
    case 'queued':
    case 'inProgress':
      return 'Puzzles appear after the game analysis and its tactics scan complete.';
    case 'failed':
      return 'Analysis failed. Puzzles are generated once the game is analyzed.';
    case 'cancelled':
      return 'Analysis was cancelled. Puzzles are generated once the game is analyzed.';
    default:
      return 'Analyze this game to review its moves and generate its puzzles.';
  }
}

function playerLabel(game: GameLike): string {
  return `${game.whitePlayer.name} vs ${game.blackPlayer.name} · ${game.result} · ${
    GAME_SOURCE_LABELS[game.source]
  }`;
}

export { GamePuzzlesPage, useGamePuzzles, sanText };
export type { PuzzlesData };
