import type * as React from 'react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import { parseTimeControl } from '@/domain/chess/timeControl';
import {
  isCustomTimeFrame,
  validateTimeFrame,
  type GameLibraryFilters,
  type LibraryGameRow,
} from '@/domain/gameLibrary';
import { dateIsoOf } from '@/domain/gameLibrary/timeframe';
import { terminationLabel, fallbackTermination } from '@/domain/chess/gameEnd';
import { useGameLibrary } from '@/hooks/useGameLibrary';
import { useLibraryAnalysis, type LibraryAnalysisApi } from '@/hooks/useLibraryAnalysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import type { GameAnalysisProgress } from '@/infrastructure/analysis';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import {
  ANALYSIS_GLYPH,
  CloseIcon,
  RefreshIcon,
  REVIEW_GLYPH,
  TrashIcon,
} from '@/components/ui/icons';
import { GameLibraryToolbar } from './GameLibraryToolbar';
import styles from './GameLibrary.module.css';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const DEFAULT_PAGE_SIZE = 50;

interface GameLibraryProps {
  readonly refreshKey: number;
  /**
   * Feature-008 analysis service. When `null` the Analysis column is hidden
   * and the bulk Analyze action stays disabled (analysis unavailable).
   */
  readonly analysisService?: AnalysisServiceLike | null;
  /** Import panels shown when the toolbar Import action is opened. */
  readonly importPanels?: React.ReactNode;
}

export function GameLibrary({
  refreshKey,
  analysisService = null,
  importPanels,
}: GameLibraryProps): React.JSX.Element {
  const library = useGameLibrary(refreshKey);
  const analysis = useLibraryAnalysis(
    analysisService ?? null,
    library.rows.map((row) => row.id),
  );
  const { filters } = library;
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<readonly string[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const totalCount = library.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const shownRows = library.rows.slice(start, start + pageSize);
  const selectedCount = library.selected.count;
  const customTimeFrame = isCustomTimeFrame(filters.timeFrame) ? filters.timeFrame : null;
  const timeFrameError = customTimeFrame ? validateTimeFrame(customTimeFrame) : null;

  // A selection can be re-analyzed when at least one of its games has a
  // completed (or outdated) run under the current engine configuration.
  const canReanalyze = [...library.selected.ids].some((id) => {
    const status = analysis.statuses[id];
    return status === 'completed' || status === 'outdated';
  });

  const update = (next: GameLibraryFilters, replace?: boolean): void => {
    setPage(1);
    library.update(next, replace);
  };

  const set = (patch: Partial<GameLibraryFilters>, replace?: boolean): void => {
    update({ ...filters, ...patch }, replace);
  };

  return (
    <section className={styles.library} data-testid="game-library">
      <GameLibraryToolbar
        filters={filters}
        timeFrameError={timeFrameError}
        isFiltering={library.isFiltering}
        selectedCount={selectedCount}
        analysisEnabled={analysis.enabled}
        canReanalyze={canReanalyze}
        importOpen={importOpen}
        onFilters={set}
        onClearFilters={() => library.clearAllFilters()}
        onToggleImport={() => setImportOpen((open) => !open)}
        onAnalyze={() => {
          if (analysis) {
            analysis.analyze([...library.selected.ids]);
          }
        }}
        onReanalyze={() => {
          if (analysis) {
            analysis.reanalyzeMany([...library.selected.ids]);
          }
        }}
        onDelete={() => setDeleteTarget([...library.selected.ids])}
      />

      {importOpen ? (
        <div className={styles.imports} data-testid="games-imports">
          {importPanels}
        </div>
      ) : null}

      {library.totalStored === 0 && !library.loading ? (
        <p className={styles.state} data-testid="library-empty">
          No games have been imported yet. Use the Import button above to bring in your Lichess or
          Chess.com games.
        </p>
      ) : null}

      <div className={styles.resultsRow}>
        <span className={styles.count} data-testid="library-count" aria-live="polite">
          {library.rows.length} of {library.totalStored} games
        </span>
        {library.rows.length > 0 ? (
          <Button
            variant="ghost"
            data-testid="library-select-all"
            onClick={() =>
              selectedCount === 0 ? library.selectAllVisible() : library.clearSelection()
            }
          >
            {selectedCount === 0 ? 'Select all' : `Clear selection (${selectedCount})`}
          </Button>
        ) : null}
      </div>

      {library.totalStored > 0 && library.rows.length === 0 && !library.loading ? (
        <p className={styles.state} data-testid="library-no-match">
          No games match your current filters.
          {library.isFiltering ? (
            <Button
              variant="ghost"
              data-testid="library-clear-filters"
              onClick={() => library.clearAllFilters()}
            >
              Clear filters
            </Button>
          ) : null}
        </p>
      ) : null}

      {library.loading && shownRows.length === 0 ? (
        <p className={styles.state} data-testid="library-loading">
          Loading games…
        </p>
      ) : null}

      {library.error ? (
        <p role="alert" className={styles.error} data-testid="library-error">
          {library.error}
        </p>
      ) : null}

      {analysis?.error ? (
        <p role="alert" className={styles.error} data-testid="analysis-error">
          {analysis.error}
        </p>
      ) : null}

      {analysis?.running ? (
        <p className={styles.progress} data-testid="library-progress" aria-live="polite">
          <span>{analysis.progressLine}</span>
          <Button
            variant="ghost"
            className={styles.cancelInline!}
            data-testid="library-analyze-cancel"
            onClick={() => analysis.cancel()}
          >
            Cancel analysis
          </Button>
        </p>
      ) : null}

      {shownRows.length > 0 ? (
        <>
          <GameRows
            rows={shownRows}
            selectedIds={library.selected.ids}
            onToggle={library.toggleRow}
            onDeleteGame={(id) => setDeleteTarget([id])}
            analysis={analysis.enabled ? analysis : null}
            statuses={analysis.statuses}
          />
          <Pagination
            totalCount={totalCount}
            pageSize={pageSize}
            page={currentPage}
            totalPages={totalPages}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            onPrevious={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        </>
      ) : null}

      {deleteTarget ? (
        <DeleteDialog
          count={deleteTarget.length}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const ids = deleteTarget;
            setDeleteTarget(null);
            void library.deleteGames(ids);
          }}
        />
      ) : null}
    </section>
  );
}

function GameRows({
  rows,
  selectedIds,
  onToggle,
  analysis,
  statuses,
  onDeleteGame,
}: {
  rows: readonly LibraryGameRow[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  analysis: LibraryAnalysisApi | null;
  statuses: Readonly<Record<string, GameAnalysisStatus>>;
  onDeleteGame: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      className={`${styles.table} ${analysis ? styles.withAnalysis : ''}`}
      role="table"
      aria-label="Imported games"
      data-testid="library-rows"
    >
      <div className={styles.header} role="row">
        <span role="columnheader" className={styles.checkHeader} aria-label="Select">
          Select
        </span>
        <span role="columnheader">White</span>
        <span role="columnheader">Black</span>
        <span role="columnheader">Result</span>
        <span role="columnheader">Time control</span>
        <span role="columnheader">Platform</span>
        <span role="columnheader">Your side</span>
        <span role="columnheader">Date</span>
        {analysis ? <span role="columnheader">Analysis</span> : null}
      </div>
      {rows.map((row) => (
        <div
          role="row"
          key={row.id}
          data-testid="game-row"
          data-user-color={row.userColor}
          className={`${styles.row} ${
            row.userColor === 'white' ? styles.rowWhite : styles.rowBlack
          }`}
          aria-selected={selectedIds.has(row.id)}
        >
          <span role="cell" className={styles.cellCheck}>
            <input
              type="checkbox"
              data-testid={`game-select-${row.id}`}
              aria-label={`Select ${row.whiteName} vs ${row.blackName}`}
              checked={selectedIds.has(row.id)}
              onChange={() => onToggle(row.id)}
            />
          </span>
          <span role="cell" data-testid="game-white" data-col="White">
            <PlayerName
              name={row.whiteName}
              rating={row.whiteRating}
              isYou={row.userColor === 'white'}
            />
          </span>
          <span role="cell" data-testid="game-black" data-col="Black">
            <PlayerName
              name={row.blackName}
              rating={row.blackRating}
              isYou={row.userColor === 'black'}
            />
          </span>
          <span role="cell" data-testid="game-result" data-col="Result">
            <ResultChip result={row.result} userColor={row.userColor} />
          </span>
          <span role="cell" data-testid="game-timecontrol" data-col="Time control">
            <span className={styles.timeControl}>{parseTimeControl(row.timeControl).display}</span>
            <span className={styles.timeControlCategory}> · {row.normalizedTimeControl}</span>
          </span>
          <span role="cell" data-testid="game-source" data-col="Platform">
            {GAME_SOURCE_LABELS[row.source]}
          </span>
          <span role="cell" data-testid="game-side" data-col="Your side">
            {row.userColor}
          </span>
          <span role="cell" data-testid="game-date" data-col="Date">
            {formatDate(row.playedAt)}
          </span>
          {analysis ? (
            <span
              role="cell"
              data-testid={`game-analysis-${row.id}`}
              data-col="Analysis"
              data-status={statuses[row.id] ?? 'unanalyzed'}
            >
              <AnalysisCell
                gameId={row.id}
                status={statuses[row.id] ?? 'unanalyzed'}
                onRun={analysis.retry}
                onReanalyze={analysis.reanalyze}
                onCancelGame={analysis.cancelGame}
                onDelete={() => onDeleteGame(row.id)}
                {...(analysis.perGameProgress[row.id]
                  ? { progress: analysis.perGameProgress[row.id] }
                  : {})}
              />
            </span>
          ) : null}
          <GameRowMeta row={row} />
          <GameRowInsights row={row} />
          {analysis?.perGameProgress[row.id] ? (
            <RowProgressBar gameId={row.id} progress={analysis.perGameProgress[row.id]!} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Player cell: name + rating, with a "You" marker on the user's side. */
function PlayerName({
  name,
  rating,
  isYou,
}: {
  name: string;
  rating: number | null;
  isYou: boolean;
}): React.JSX.Element {
  return (
    <span className={styles.playerCell}>
      <span className={styles.playerName}>
        {name}
        {rating !== null ? <span className={styles.playerRating}> {rating}</span> : null}
      </span>
      {isYou ? (
        <span className={styles.youChip} data-testid="game-you">
          You
        </span>
      ) : null}
    </span>
  );
}

type RowOutcome = 'win' | 'loss' | 'draw' | 'unknown';

function outcomeOf(userColor: string, result: string): RowOutcome {
  if (result === '1/2-1/2') {
    return 'draw';
  }
  if (result === '*') {
    return 'unknown';
  }
  const userWon = result === '1-0' ? userColor === 'white' : userColor === 'black';
  return userWon ? 'win' : 'loss';
}

/** Colored win/loss/draw chip for the user's perspective. */
function ResultChip({
  result,
  userColor,
}: {
  result: string;
  userColor: 'white' | 'black';
}): React.JSX.Element {
  const outcome = outcomeOf(userColor, result);
  const glyph = outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : outcome === 'draw' ? '½' : '•';
  return (
    <span
      className={`${styles.resultChip} ${styles[`outcome${outcome.charAt(0).toUpperCase()}${outcome.slice(1)}`]}`}
      data-testid="game-result-chip"
      data-outcome={outcome}
      title={`${outcome} — ${result}`}
    >
      {glyph}
      <span className={styles.resultToken}>{result}</span>
    </span>
  );
}

/** Second, full-width row line: how the game ended + its length. */
function GameRowMeta({ row }: { row: LibraryGameRow }): React.JSX.Element | null {
  if (row.moveCount === 0 && row.result === '*') {
    return null;
  }
  const effective = row.termination ?? fallbackTermination(row.result);
  const parts: string[] = [terminationLabel(effective)];
  if (row.moveCount > 0) {
    parts.push(`${row.moveCount} ${row.moveCount === 1 ? 'move' : 'moves'}`);
  }
  return (
    <div className={styles.rowMeta} data-testid={`game-meta-${row.id}`}>
      {parts.join(' · ')}
    </div>
  );
}

/**
 * One presentable statistics value of the row insights strip. `text` is the
 * visible form; `spoken` spells it out for the labelled region's
 * screen-reader sentence.
 */
interface RowInsightItem {
  readonly key: string;
  readonly testId: string;
  readonly text: string;
  readonly spoken: string;
}

const ERROR_COUNT_ITEMS: ReadonlyArray<{
  readonly countKey: 'blunder' | 'mistake' | 'inaccuracy';
  readonly plural: string;
  readonly singular: string;
  readonly testId: string;
}> = [
  { countKey: 'blunder', plural: 'Blunders', singular: 'blunder', testId: 'row-insights-blunders' },
  { countKey: 'mistake', plural: 'Mistakes', singular: 'mistake', testId: 'row-insights-mistakes' },
  {
    countKey: 'inaccuracy',
    plural: 'Inaccuracies',
    singular: 'inaccuracy',
    testId: 'row-insights-inaccuracies',
  },
];

function spokenCount(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

/**
 * The user-side insight values of a row's latest completed analysis. Renders
 * only for a completed/outdated run and only when the owning data exists —
 * absent data is never rendered as a zero (specs/domain/game-library.md §7).
 */
function rowInsightItemsFor(row: LibraryGameRow): readonly RowInsightItem[] {
  if (row.analysisStatus !== 'completed' && row.analysisStatus !== 'outdated') {
    return [];
  }
  const items: RowInsightItem[] = [];
  if (typeof row.accuracy === 'number') {
    items.push({
      key: 'accuracy',
      testId: 'row-insights-accuracy',
      text: `Accuracy ${row.accuracy}%`,
      spoken: `Accuracy ${row.accuracy} per cent`,
    });
  }
  const counts = row.classificationCounts;
  if (counts) {
    for (const meta of ERROR_COUNT_ITEMS) {
      const count = counts[meta.countKey];
      items.push({
        key: meta.countKey,
        testId: meta.testId,
        text: `${meta.plural} ${count}`,
        spoken: spokenCount(count, meta.singular, meta.plural.toLowerCase()),
      });
    }
  }
  if (row.hasCompletedDetection === true && typeof row.missedTactics === 'number') {
    const count = row.missedTactics;
    items.push({
      key: 'missedTactics',
      testId: 'row-insights-missed-tactics',
      text: `Missed tactics ${count}`,
      spoken: spokenCount(count, 'missed tactic', 'missed tactics'),
    });
  }
  return items;
}

/**
 * Full-width insights line under a row's meta: Accuracy · Blunders ·
 * Mistakes · Inaccuracies · Missed tactics for the user's latest completed
 * analysis. One labelled region per row whose screen-reader text spells out
 * every value.
 */
function GameRowInsights({ row }: { row: LibraryGameRow }): React.JSX.Element | null {
  const items = rowInsightItemsFor(row);
  if (items.length === 0) {
    return null;
  }
  const sentence = items.map((item) => item.spoken).join(', ');
  return (
    <div
      className={styles.rowInsights}
      role="region"
      aria-label={sentence}
      data-testid={`row-insights-${row.id}`}
    >
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? (
            <span className={styles.separator} aria-hidden="true">
              {' '}
              ·{' '}
            </span>
          ) : null}
          <span data-testid={item.testId}>{item.text}</span>
        </Fragment>
      ))}
    </div>
  );
}

const STATUS_LABELS: Readonly<Record<GameAnalysisStatus, string>> = {
  unanalyzed: 'Not analyzed',
  queued: 'Queued',
  inProgress: 'Analyzing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  outdated: 'Outdated',
};

interface StatusBadgeMeta {
  readonly tone: 'muted' | 'accent' | 'warning' | 'danger';
  readonly glyph: string;
  readonly info: string;
}

/** Which non-trivial statuses get a colored badge at the end of the actions. */
const STATUS_BADGES: Partial<Record<GameAnalysisStatus, StatusBadgeMeta>> = {
  queued: {
    tone: 'muted',
    glyph: '…',
    info: 'Queued — this game is waiting for the engine.',
  },
  inProgress: {
    tone: 'accent',
    glyph: '…',
    info: 'Analyzing — the engine is working through this game.',
  },
  cancelled: {
    tone: 'muted',
    glyph: '✕',
    info: 'Cancelled — this run was stopped. Retry to analyze it.',
  },
  failed: {
    tone: 'danger',
    glyph: '!',
    info: 'Failed — the engine could not analyze this game. Retry to analyze it.',
  },
  outdated: {
    tone: 'warning',
    glyph: '!',
    info: 'Outdated — this analysis used an older engine or settings. Re-analyze to refresh it.',
  },
};

/**
 * Compact colored status indicator for non-trivial analysis states. The glyph
 * and colour carry the state; activating it (hover on desktop, tap on touch,
 * Enter/Space with a keyboard) reveals the explanatory text so colour is never
 * the only signal.
 */
function RowStatusBadge({
  gameId,
  status,
  progress,
}: {
  gameId: string;
  status: GameAnalysisStatus;
  progress?: GameAnalysisProgress;
}): React.JSX.Element | null {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const meta = STATUS_BADGES[status];
  if (!meta) {
    return null;
  }
  const open = hover || pinned;
  const detail =
    status === 'inProgress' && progress && progress.totalPositions > 0
      ? `${meta.info} ${progress.completedPositions}/${progress.totalPositions} positions.`
      : meta.info;
  return (
    <span className={styles.statusBadgeWrap}>
      <button
        type="button"
        className={`${styles.statusBadge} ${styles[`statusBadge${meta.tone}`]}`}
        data-testid={`game-status-${gameId}`}
        aria-expanded={open}
        aria-label={`${STATUS_LABELS[status]}: ${detail}`}
        title={detail}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => setPinned((current) => !current)}
      >
        <span aria-hidden="true">{meta.glyph}</span>
      </button>
      {open ? (
        <span
          className={styles.statusBadgeInfo}
          role="status"
          data-testid={`game-status-info-${gameId}`}
        >
          {detail}
        </span>
      ) : null}
    </span>
  );
}

function DeleteRowButton({
  gameId,
  status,
  onDelete,
}: {
  gameId: string;
  status: GameAnalysisStatus;
  onDelete: (gameId: string) => void;
}): React.JSX.Element {
  return (
    <IconButton
      label={`Delete ${STATUS_LABELS[status].toLowerCase()} game`}
      dataTestId={`game-delete-${gameId}`}
      className={styles.rowAction!}
      onClick={() => onDelete(gameId)}
    >
      <TrashIcon />
    </IconButton>
  );
}

function AnalysisCell({
  gameId,
  status,
  progress,
  onRun,
  onReanalyze,
  onCancelGame,
  onDelete,
}: {
  gameId: string;
  status: GameAnalysisStatus;
  /** Live per-game progress for a queued/in-progress job, when available. */
  progress?: GameAnalysisProgress;
  /** Run an analysis for this game (Analyze / Retry / Re-analyze). */
  onRun: (gameId: string) => void;
  /** Force a re-analysis of a completed game (engine/settings change). */
  onReanalyze: (gameId: string) => void;
  /** Cancel this game's queued/in-progress job (per-row cancel). */
  onCancelGame: (gameId: string) => void;
  /** Open the delete confirmation for this one game. */
  onDelete: (gameId: string) => void;
}): React.JSX.Element {
  const showOutdated = status === 'outdated';
  const showFailed = status === 'failed' || status === 'cancelled';
  const showActive = status === 'queued' || status === 'inProgress';

  return (
    <span className={styles.statusWrap}>
      {status === 'completed' || showOutdated ? (
        <>
          <Link
            className={styles.rowReviewLink}
            data-testid={`game-review-${gameId}`}
            to={`/games/${gameId}/review`}
            aria-label={`Review ${gameId}`}
            title="Review"
          >
            <span aria-hidden="true" className={styles.reviewGlyph}>
              {REVIEW_GLYPH}
            </span>
          </Link>
          <IconButton
            label="Re-analyze"
            dataTestId={`game-reanalyze-${gameId}`}
            className={styles.rowAction!}
            onClick={() => onReanalyze(gameId)}
          >
            <RefreshIcon />
          </IconButton>
        </>
      ) : null}

      {showFailed ? (
        <IconButton
          label="Retry analysis"
          dataTestId={`game-retry-${gameId}`}
          className={styles.rowAction!}
          onClick={() => onRun(gameId)}
        >
          <RefreshIcon />
        </IconButton>
      ) : null}

      {status === 'unanalyzed' ? (
        <IconButton
          label="Analyze game"
          dataTestId={`game-analyze-${gameId}`}
          className={styles.rowAction!}
          onClick={() => onRun(gameId)}
        >
          <span aria-hidden="true">{ANALYSIS_GLYPH}</span>
        </IconButton>
      ) : null}

      {showActive ? (
        <IconButton
          label="Cancel analysis"
          dataTestId={`game-cancel-${gameId}`}
          className={styles.rowAction!}
          onClick={() => onCancelGame(gameId)}
        >
          <CloseIcon />
        </IconButton>
      ) : null}

      <DeleteRowButton gameId={gameId} status={status} onDelete={onDelete} />
      <RowStatusBadge gameId={gameId} status={status} {...(progress ? { progress } : {})} />
    </span>
  );
}

/** Full-width row progress strip (bar + status text) under an analyzing row. */
function RowProgressBar({
  gameId,
  progress,
}: {
  gameId: string;
  progress: GameAnalysisProgress;
}): React.JSX.Element | null {
  const percent = progress.totalPositions > 0 ? positionPercent(progress) : 0;
  const profileLabel = progress.profile;
  return (
    <div
      className={styles.rowProgressBar}
      data-testid={`game-progress-bar-${gameId}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Analyzing ${progress.completedPositions} of ${progress.totalPositions} positions, ${percent} per cent, ${profileLabel} profile`}
    >
      <span className={styles.rowProgressTrack}>
        <span
          className={styles.rowProgressFill}
          style={{ width: `${percent}%` }}
          data-testid={`game-progress-fill-${gameId}`}
        />
      </span>
      <span className={styles.rowProgressText} data-testid={`game-progress-${gameId}`}>
        {progress.completedPositions}/{progress.totalPositions} positions · {percent}% ·{' '}
        {profileLabel}
      </span>
    </div>
  );
}

function positionPercent(progress: GameAnalysisProgress): number {
  if (progress.totalPositions <= 0) {
    return 0;
  }
  return Math.round((progress.completedPositions / progress.totalPositions) * 100);
}

function Pagination({
  totalCount,
  pageSize,
  page,
  totalPages,
  onPageSize,
  onPrevious,
  onNext,
}: {
  totalCount: number;
  pageSize: number;
  page: number;
  totalPages: number;
  onPageSize: (size: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.pagination} data-testid="library-pagination">
      <label className={styles.paginationField}>
        <span className={styles.fieldLabel}>Rows per page</span>
        <select
          data-testid="library-page-size"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.paginationStatus} data-testid="library-page-status">
        Page {page} of {totalPages} · {totalCount} games
      </span>
      <div className={styles.paginationActions}>
        <Button
          variant="secondary"
          data-testid="library-page-prev"
          disabled={page <= 1}
          onClick={onPrevious}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          data-testid="library-page-next"
          disabled={page >= totalPages}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function DeleteDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className={styles.dialog}>
        <h2 id="delete-title" className={styles.dialogTitle}>
          Delete {count} {count === 1 ? 'game' : 'games'}?
        </h2>
        <p className={styles.dialogBody}>
          This permanently removes {count === 1 ? 'this game' : 'these games'} and any derived
          analysis or puzzles from your local library. This cannot be undone.
        </p>
        <div className={styles.dialogActions}>
          <Button variant="secondary" data-testid="delete-cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button data-testid="delete-confirm" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatDate(playedAtIso: string | null): string {
  if (playedAtIso === null) {
    return '—';
  }
  const date = dateIsoOf(playedAtIso);
  return date ?? '—';
}
