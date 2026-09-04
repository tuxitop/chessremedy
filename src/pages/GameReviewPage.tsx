import { useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  buildTreeFromPgn,
  positionAtPath,
  pathToEnd,
  step,
} from '@/components/chessboard/positionTree';
import type { MovePly, MoveTree, Path } from '@/components/chessboard/positionTree';
import { Chessboard } from '@/components/chessboard/Chessboard';
import type { Key } from '@lichess-org/chessground/types';
import { MoveList } from '@/components/chessboard/MoveList';
import { Navigation } from '@/components/chessboard/Navigation';
import type { MoveAnalysis, MoveClassification } from '@/domain/chess';
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
        gameId={data.game.id}
        pgn={data.game.pgn}
        userColor={data.game.userColor}
        playerLabel={playerLabel(data.game)}
        records={data.records}
        obsolete={data.obsolete}
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
  gameId,
  pgn,
  userColor,
  playerLabel,
  records,
  obsolete,
  onReanalyze,
  reanalyzing,
}: {
  gameId: string;
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

  const mainline = useMemo(() => mainlineOf(tree), [tree]);
  const position = useMemo(() => (tree ? positionAtPath(tree, path) : null), [tree, path]);
  const lastMove = useMemo(() => {
    const last = path[path.length - 1];
    return last ? ([last.from, last.to] as readonly [Key, Key]) : null;
  }, [path]);
  const nagOverrides = useMemo(() => buildNagOverrides(mainline, records), [mainline, records]);
  const summary = useMemo(() => summarizeAnalysis(records, userColor), [records, userColor]);

  if (!tree || !position) {
    return (
      <StatePanel title="Cannot display game" description="The stored PGN could not be replayed." />
    );
  }

  const navigate = (target: 'first' | 'prev' | 'next' | 'last'): void => {
    if (target === 'first') {
      setPath([]);
    } else if (target === 'last') {
      setPath(pathToEnd(tree, path));
    } else {
      setPath(step(tree, path, target === 'next' ? 1 : -1));
    }
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
        ) : null}
      </header>

      <div className={styles.layout} data-testid="review-layout">
        <div className={styles.boardColumn}>
          <Chessboard
            position={position}
            interactive={false}
            orientation={userColor}
            lastMove={lastMove}
          />
          <Navigation currentPly={path.length} totalPlies={mainline.length} onNavigate={navigate} />
          <p className={styles.gameId} data-testid="review-game-id">
            {gameId}
          </p>
        </div>
        <aside className={styles.sidePanel}>
          <ReviewSummary summary={summary} userColor={userColor} />
          <MoveList tree={tree} path={path} onSeek={setPath} nagOverrides={nagOverrides} />
        </aside>
      </div>
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
