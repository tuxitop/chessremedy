import type * as React from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import { parseTimeControl } from '@/domain/chess/timeControl';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import {
  LIBRARY_PLATFORMS,
  TIME_FRAME_PRESETS,
  isCustomTimeFrame,
  presetTimeFrame,
  validateTimeFrame,
  type GameLibraryFilters,
  type LibraryGameRow,
  type NonCustomTimeFramePreset,
} from '@/domain/gameLibrary';
import { dateIsoOf } from '@/domain/gameLibrary/timeframe';
import { useGameLibrary } from '@/hooks/useGameLibrary';
import { useLibraryAnalysis, type LibraryAnalysisApi } from '@/hooks/useLibraryAnalysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import { Button } from '@/components/ui/Button';
import styles from './GameLibrary.module.css';

const TIME_FRAME_LABELS: Readonly<Record<string, string>> = {
  all: 'All time',
  today: 'Today',
  last7d: 'Last 7 days',
  last30d: 'Last 30 days',
  last3m: 'Last 3 months',
  last6m: 'Last 6 months',
  lastYear: 'Last year',
  custom: 'Custom range',
};

const PAGE_SIZES = [25, 50, 100, 250] as const;
const DEFAULT_PAGE_SIZE = 50;

interface GameLibraryProps {
  readonly refreshKey: number;
  /**
   * Feature-008 analysis service. When `null` the Analysis column is hidden
   * and the bulk Analyze action stays disabled (analysis unavailable).
   */
  readonly analysisService?: AnalysisServiceLike | null;
}

export function GameLibrary({
  refreshKey,
  analysisService = null,
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

  const totalCount = library.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const shownRows = library.rows.slice(start, start + pageSize);
  const selectedCount = library.selected.count;
  const customTimeFrame = isCustomTimeFrame(filters.timeFrame) ? filters.timeFrame : null;
  const timeFrameError =
    customTimeFrame && (customTimeFrame.from !== '' || customTimeFrame.to !== '')
      ? validateTimeFrame(customTimeFrame)
      : null;

  const update = (next: GameLibraryFilters, replace?: boolean): void => {
    setPage(1);
    library.update(next, replace);
  };

  const set = (patch: Partial<GameLibraryFilters>, replace?: boolean): void => {
    update({ ...filters, ...patch }, replace);
  };

  return (
    <section className={styles.library} data-testid="game-library">
      <SearchControls search={filters.search} onSearch={(search) => set({ search }, true)} />

      {library.totalStored === 0 && !library.loading ? (
        <p className={styles.state} data-testid="library-empty">
          No games have been imported yet. Use the Import section above to bring in your Lichess or
          Chess.com games.
        </p>
      ) : (
        <>
          <FilterBar
            filters={filters}
            timeFrameError={timeFrameError}
            isFiltering={library.isFiltering}
            onChange={(patch) => set(patch)}
            onCustomRange={(from, to) => set({ timeFrame: { preset: 'custom', from, to } })}
            onClearAll={() => library.clearAllFilters()}
          />

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

          {analysis?.running && analysis.progressLine ? (
            <p className={styles.progress} data-testid="library-progress" aria-live="polite">
              {analysis.progressLine}
            </p>
          ) : null}

          {selectedCount > 0 ? (
            <div className={styles.selectionBar} data-testid="library-selection-bar">
              <span className={styles.selectionCount}>Selected: {selectedCount}</span>
              <Button
                variant="secondary"
                disabled={!analysis?.enabled || analysis.running || selectedCount === 0}
                title={
                  analysis?.enabled ? undefined : 'Analysis is unavailable. Start the engine first.'
                }
                data-testid="library-analyze"
                onClick={() => {
                  if (analysis) {
                    analysis.analyze([...library.selected.ids]);
                  }
                }}
              >
                {analysis?.running ? 'Analyzing…' : 'Analyze'}
              </Button>
              {analysis?.running ? (
                <Button
                  variant="secondary"
                  data-testid="library-analyze-cancel"
                  onClick={() => analysis.cancel()}
                >
                  Cancel analysis
                </Button>
              ) : null}
              <Button
                variant="secondary"
                data-testid="library-delete"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            </div>
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
        </>
      )}

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

function SearchControls({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (search: string) => void;
}): React.JSX.Element {
  return (
    <div className={styles.searchRow}>
      <label className={styles.searchField}>
        <span className={styles.srOnly}>Search games</span>
        <input
          data-testid="library-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search games by player or game id…"
          autoComplete="off"
        />
      </label>
      {search !== '' ? (
        <Button variant="ghost" data-testid="library-search-clear" onClick={() => onSearch('')}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}

interface FilterBarProps {
  readonly filters: GameLibraryFilters;
  readonly timeFrameError: string | null;
  readonly isFiltering: boolean;
  readonly onChange: (patch: Partial<GameLibraryFilters>) => void;
  readonly onCustomRange: (from: string, to: string) => void;
  readonly onClearAll: () => void;
}

function FilterBar({
  filters,
  timeFrameError,
  isFiltering,
  onChange,
  onCustomRange,
  onClearAll,
}: FilterBarProps): React.JSX.Element {
  const custom = isCustomTimeFrame(filters.timeFrame) ? filters.timeFrame : null;
  return (
    <div className={styles.filterBar} data-testid="library-filter-bar">
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Time</span>
        <select
          data-testid="filter-time"
          value={filters.timeFrame.preset}
          onChange={(e) => {
            const preset = e.target.value;
            if (preset === 'custom') {
              onChange({ timeFrame: { preset: 'custom', from: '', to: '' } });
            } else {
              onChange({ timeFrame: presetTimeFrame(preset as NonCustomTimeFramePreset) });
            }
          }}
        >
          {[...TIME_FRAME_PRESETS, 'custom'].map((preset) => (
            <option key={preset} value={preset}>
              {TIME_FRAME_LABELS[preset]}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Time control</span>
        <select
          data-testid="filter-timecontrol"
          value={filters.timeControl}
          onChange={(e) => onChange({ timeControl: e.target.value as TimeControlFilterValue })}
        >
          <option value="all">All</option>
          {TIME_CONTROL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Side</span>
        <select
          data-testid="filter-side"
          value={filters.side}
          onChange={(e) => onChange({ side: e.target.value as GameLibraryFilters['side'] })}
        >
          <option value="all">All</option>
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Platform</span>
        <select
          data-testid="filter-platform"
          value={filters.platform}
          onChange={(e) => onChange({ platform: e.target.value as GameLibraryFilters['platform'] })}
        >
          <option value="all">All</option>
          {LIBRARY_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {GAME_SOURCE_LABELS[platform]}
            </option>
          ))}
        </select>
      </label>

      {custom ? (
        <div className={styles.customRange} data-testid="filter-custom-range">
          <input
            type="date"
            aria-label="Start date"
            data-testid="filter-date-from"
            value={custom.from}
            onChange={(e) => onCustomRange(e.target.value, custom.to)}
          />
          <span aria-hidden="true">→</span>
          <input
            type="date"
            aria-label="End date"
            data-testid="filter-date-to"
            value={custom.to}
            onChange={(e) => onCustomRange(custom.from, e.target.value)}
          />
          {timeFrameError ? (
            <span className={styles.error} role="alert">
              {timeFrameError}
            </span>
          ) : null}
        </div>
      ) : null}

      {isFiltering ? (
        <Button variant="ghost" data-testid="filter-clear-all" onClick={onClearAll}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

type TimeControlFilterValue = 'all' | TimeControlCategory;

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
          className={styles.row}
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
            {row.whiteName}
          </span>
          <span role="cell" data-testid="game-black" data-col="Black">
            {row.blackName}
          </span>
          <span role="cell" data-testid="game-result" data-col="Result">
            {row.result}
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
              />
            </span>
          ) : null}
        </div>
      ))}
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
  onRun,
}: {
  gameId: string;
  status: GameAnalysisStatus;
  /** Run an analysis for this game (Analyze / Retry / Re-analyze). */
  onRun: (gameId: string) => void;
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
    <span
      className={status === 'inProgress' ? styles.analyzing : styles.statusLabel}
      data-testid={`game-analysis-label-${gameId}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
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
