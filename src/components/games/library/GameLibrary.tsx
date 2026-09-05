import type * as React from 'react';
import { useState } from 'react';
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
import { terminationLabel } from '@/domain/chess/gameEnd';
import { useGameLibrary } from '@/hooks/useGameLibrary';
import { useLibraryAnalysis, type LibraryAnalysisApi } from '@/hooks/useLibraryAnalysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import type { GameAnalysisProgress } from '@/infrastructure/analysis';
import { Button } from '@/components/ui/Button';
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const totalCount = library.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const shownRows = library.rows.slice(start, start + pageSize);
  const selectedCount = library.selected.count;
  const customTimeFrame = isCustomTimeFrame(filters.timeFrame) ? filters.timeFrame : null;
  const timeFrameError = customTimeFrame ? validateTimeFrame(customTimeFrame) : null;

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
        importOpen={importOpen}
        onFilters={set}
        onClearFilters={() => library.clearAllFilters()}
        onToggleImport={() => setImportOpen((open) => !open)}
        onAnalyze={() => {
          if (analysis) {
            analysis.analyze([...library.selected.ids]);
          }
        }}
        onDelete={() => setConfirmingDelete(true)}
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

      {confirmingDelete ? (
        <DeleteDialog
          count={selectedCount}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            void library.deleteSelected();
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
}: {
  rows: readonly LibraryGameRow[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  analysis: LibraryAnalysisApi | null;
  statuses: Readonly<Record<string, GameAnalysisStatus>>;
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
                onCancelGame={analysis.cancelGame}
                {...(analysis.perGameProgress[row.id]
                  ? { progress: analysis.perGameProgress[row.id] }
                  : {})}
              />
            </span>
          ) : null}
          <GameRowMeta row={row} />
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
  const label = terminationLabel(row.termination);
  if (label === null && row.moveCount === 0) {
    return null;
  }
  const parts: string[] = [];
  if (label !== null) {
    parts.push(label);
  }
  if (row.moveCount > 0) {
    parts.push(`${row.moveCount} ${row.moveCount === 1 ? 'move' : 'moves'}`);
  }
  return (
    <div className={styles.rowMeta} data-testid={`game-meta-${row.id}`}>
      {parts.join(' · ')}
    </div>
  );
}

const STATUS_LABELS: Readonly<Record<GameAnalysisStatus, string>> = {
  unanalyzed: 'Not analyzed',
  queued: 'Queued',
  inProgress: 'Analyzing…',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  outdated: 'Outdated',
};
function AnalysisCell({
  gameId,
  status,
  progress,
  onRun,
  onCancelGame,
}: {
  gameId: string;
  status: GameAnalysisStatus;
  /** Live per-game progress for a queued/in-progress job, when available. */
  progress?: GameAnalysisProgress;
  /** Run an analysis for this game (Analyze / Retry / Re-analyze). */
  onRun: (gameId: string) => void;
  /** Cancel this game's queued/in-progress job (per-row cancel). */
  onCancelGame: (gameId: string) => void;
}): React.JSX.Element {
  if (status === 'completed') {
    return (
      <Link
        className={styles.reviewLink}
        data-testid={`game-review-${gameId}`}
        to={`/games/${gameId}/review`}
      >
        Review
      </Link>
    );
  }
  if (status === 'outdated') {
    return (
      <span className={styles.statusWrap}>
        <span className={styles.statusLabel}>{STATUS_LABELS[status]}</span>
        <Link
          className={styles.reviewLink}
          data-testid={`game-review-${gameId}`}
          to={`/games/${gameId}/review`}
        >
          Review
        </Link>
        <Button
          variant="ghost"
          className={styles.retryButton!}
          data-testid={`game-reanalyze-${gameId}`}
          onClick={() => onRun(gameId)}
        >
          Re-analyze
        </Button>
      </span>
    );
  }
  if (status === 'failed' || status === 'cancelled') {
    return (
      <span className={styles.statusWrap}>
        <span className={styles.statusLabel}>{STATUS_LABELS[status]}</span>
        <Button
          variant="ghost"
          className={styles.retryButton!}
          data-testid={`game-retry-${gameId}`}
          onClick={() => onRun(gameId)}
        >
          Retry
        </Button>
      </span>
    );
  }
  if (status === 'unanalyzed') {
    return (
      <span className={styles.statusWrap}>
        <Button
          variant="ghost"
          className={styles.retryButton!}
          data-testid={`game-analyze-${gameId}`}
          onClick={() => onRun(gameId)}
        >
          Analyze
        </Button>
      </span>
    );
  }
  return (
    <span className={styles.statusWrap}>
      <span className={status === 'inProgress' ? styles.analyzing : styles.statusLabel}>
        {STATUS_LABELS[status]}
      </span>
      {progress && progress.totalPositions > 0 ? (
        <span className={styles.rowProgress} data-testid={`game-progress-${gameId}`}>
          {progress.completedPositions}/{progress.totalPositions} positions ·{' '}
          {positionPercent(progress)}% · {progress.profile}
        </span>
      ) : null}
      <Button
        variant="ghost"
        className={styles.retryButton!}
        data-testid={`game-cancel-${gameId}`}
        onClick={() => onCancelGame(gameId)}
      >
        Cancel
      </Button>
    </span>
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
