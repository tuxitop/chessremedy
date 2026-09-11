import type * as React from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
import { useCloseInterruptGuard } from '@/hooks/useCloseInterruptGuard';
import {
  useLibraryAnalysis,
  type AnalysisQueuePositions,
  type LibraryAnalysisApi,
} from '@/hooks/useLibraryAnalysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import type { GameAnalysisStatus } from '@/domain/analysis';
import type { GameAnalysisProgress } from '@/infrastructure/analysis';
import { DETECTION_VERSION } from '@/domain/tactics';
import { PUZZLE_GENERATOR_VERSION } from '@/domain/puzzle';
import { formatAccuracy } from '@/domain/analysis/classificationMeta';
import {
  classificationCountColor,
  missedTacticCountColor,
  puzzleCountColor,
} from '@/components/analysis/classificationColors';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import {
  ANALYSIS_GLYPH,
  CloseIcon,
  PUZZLES_GLYPH,
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

  // Auto-refresh: a row's insights strip appears as soon as its game's
  // analysis completes (queued/in-progress → completed/outdated) without a
  // manual page refresh. One debounced `library.reload()` per settling batch.
  const lastStatusSignature = useRef<string | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRowReload = useCallback(() => {
    if (reloadTimer.current !== null) {
      clearTimeout(reloadTimer.current);
    }
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      library.reload();
    }, 250);
  }, [library]);

  useEffect(() => {
    const signature = Object.entries(analysis.statuses)
      .filter(
        ([, status]) =>
          status === 'queued' ||
          status === 'inProgress' ||
          status === 'completed' ||
          status === 'outdated',
      )
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, status]) => `${id}:${status}`)
      .join('|');
    if (lastStatusSignature.current === null) {
      lastStatusSignature.current = signature;
      return;
    }
    if (signature !== lastStatusSignature.current) {
      lastStatusSignature.current = signature;
      scheduleRowReload();
    }
  }, [analysis.statuses, scheduleRowReload]);

  useEffect(() => {
    const timer = reloadTimer.current;
    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Summary backfill (Feature 010): older analyzed games whose latest
  // completed run predates the per-analysis summary table have no insights.
  // For any displayed completed/outdated row still missing them, derive and
  // store an `absent`-detection summary, then reload once.
  const backfillAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!analysisService) {
      return;
    }
    const needBackfill = library.rows.filter((row) => {
      if (row.analysisStatus !== 'completed' && row.analysisStatus !== 'outdated') {
        return false;
      }
      if (backfillAttempted.current.has(row.id)) {
        return false;
      }
      return !row.accuracy && !row.classificationCounts;
    });
    if (needBackfill.length === 0) {
      return;
    }
    const ids = needBackfill.map((row) => row.id);
    for (const id of ids) {
      backfillAttempted.current.add(id);
    }
    let cancelled = false;
    void (async () => {
      try {
        await analysisService.ensureSummariesForRows?.(ids);
      } catch {
        // Backfill is best-effort; the strip simply stays absent.
      }
      if (!cancelled) {
        library.reload();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisService, library, library.rows]);

  // Live Feature-010 scan registry (P7): whether each row's detection pass is
  // genuinely running in *this* session. A persisted `queued`/`inProgress`
  // summary only reads "scanning…" while the shared service reports the game
  // as live; otherwise the pass was interrupted (an earlier session or a
  // cancelled run) and the strip says so instead of lying about a running scan.
  const [activeDetectionIds, setActiveDetectionIds] = useState<Readonly<Set<string>>>(new Set());
  const [liveAnalysisIds, setLiveAnalysisIds] = useState<Readonly<Set<string>>>(new Set());
  // Live Feature-011 puzzle-generation registry (mirror of the scan registry):
  // a persisted `queued`/`inProgress` puzzle summary only reads "generating…"
  // while the service reports the game live; otherwise it is interrupted.
  const [activeGenerationIds, setActiveGenerationIds] = useState<Readonly<Set<string>>>(new Set());
  const activeDetectionRef = useRef<ReadonlySet<string>>(new Set());
  const activeGenerationRef = useRef<ReadonlySet<string>>(new Set());
  /** Game ids whose scan was started from this page but may finish before the
   *  poll observes them live (short passes): their settle still reloads rows. */
  const justStartedScans = useRef<ReadonlySet<string>>(new Set());
  /** Game ids whose generation pass was started from this page but may finish
   *  before the poll observes it live (short passes): settle still reloads. */
  const justStartedGenerations = useRef<ReadonlySet<string>>(new Set());
  // Latest rows/reload for the always-on detection poll (kept out of its deps
  // so a reload never restarts the loop into a busy cycle).
  const libraryRef = useRef(library);
  useEffect(() => {
    libraryRef.current = library;
  });

  // Poll the in-memory session registries every few seconds while the Library
  // is open: which scans are genuinely running (strip label + settle reload)
  // and which analysis jobs are genuinely live this session (paused rows must
  // never read as "analyzing"). Pure display work — never schedules engine work.
  useEffect(() => {
    const service = analysisService;
    const canPoll =
      service &&
      (typeof service.activeDetectionGames === 'function' ||
        typeof service.activeGenerationGames === 'function' ||
        typeof service.liveAnalysisGames === 'function');
    if (!service || !canPoll) {
      return;
    }
    let disposed = false;
    // Plan-013 W3 / Feature-011 Stage D: while a scan or a generation pass is
    // live, refresh rows at a slow cadence so the persisted progress (scan or
    // puzzle `done/total`) advances the row's bar; never more often than every
    // few seconds, and never while a reload is already in flight.
    let lastLiveReload = 0;
    const tick = async (): Promise<void> => {
      if (disposed) {
        return;
      }
      let active = new Set<string>();
      if (typeof service.activeDetectionGames === 'function') {
        try {
          active = new Set(await service.activeDetectionGames!());
        } catch {
          active = new Set();
        }
      }
      let generating = new Set<string>();
      if (typeof service.activeGenerationGames === 'function') {
        try {
          generating = new Set(await service.activeGenerationGames!());
        } catch {
          generating = new Set();
        }
      }
      let live = new Set<string>();
      if (typeof service.liveAnalysisGames === 'function') {
        try {
          live = new Set(await service.liveAnalysisGames!());
        } catch {
          live = new Set();
        }
      }
      if (disposed) {
        return;
      }
      // A scan started on this page that already finished (never seen live by
      // the poll) still reloads its row so the real state/count appears.
      const justFinished = [...justStartedScans.current].filter((id) => !active.has(id));
      if (justFinished.length > 0) {
        justStartedScans.current = new Set(
          [...justStartedScans.current].filter((id) => active.has(id)),
        );
        if (libraryRef.current.rows.some((row) => row.id === justFinished[0])) {
          libraryRef.current.reload();
        }
      }
      // Same for a generation pass started on this page (Feature 011): its
      // settle must still reload the row so the real puzzle count/note appears.
      const genJustFinished = [...justStartedGenerations.current].filter(
        (id) => !generating.has(id),
      );
      if (genJustFinished.length > 0) {
        justStartedGenerations.current = new Set(
          [...justStartedGenerations.current].filter((id) => generating.has(id)),
        );
        if (libraryRef.current.rows.some((row) => row.id === genJustFinished[0])) {
          libraryRef.current.reload();
        }
      }
      setActiveDetectionIds(active);
      setActiveGenerationIds(generating);
      setLiveAnalysisIds(live);
      // A scan that was live and is no longer live just finished (or was
      // interrupted mid-session): reload once so the strip shows its real
      // settled state (count, or the interrupted note).
      for (const id of activeDetectionRef.current) {
        if (!active.has(id) && libraryRef.current.rows.some((row) => row.id === id)) {
          libraryRef.current.reload();
          break;
        }
      }
      // A generation pass that was live and is no longer live just settled (or
      // was interrupted mid-session): reload once so the row shows its real
      // puzzle count/state note.
      for (const id of activeGenerationRef.current) {
        if (!generating.has(id) && libraryRef.current.rows.some((row) => row.id === id)) {
          libraryRef.current.reload();
          break;
        }
      }
      // Live scan/generation progress refresh: while a displayed game's scan or
      // generation pass is genuinely running, reload at a throttled cadence so
      // its persisted `done/total` advances the distinct-colour progress bar.
      const liveOnRows = [...active, ...generating].some((id) =>
        libraryRef.current.rows.some((row) => row.id === id),
      );
      const nowMs = Date.now();
      if (liveOnRows && !libraryRef.current.loading && nowMs - lastLiveReload > 2_500) {
        lastLiveReload = nowMs;
        libraryRef.current.reload();
      }
      activeDetectionRef.current = active;
      activeGenerationRef.current = generating;
    };
    const timer = setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      disposed = true;
      clearInterval(timer);
      activeDetectionRef.current = new Set();
      activeGenerationRef.current = new Set();
      justStartedScans.current = new Set();
      justStartedGenerations.current = new Set();
    };
  }, [analysisService]);

  // Orphan reconciliation (WP-A): a cheap, engine-free pass — owner-less
  // in-progress detection summaries are paused (never silently "in progress").
  // Analysis jobs left by an earlier session stay paused too: they are resumed
  // only by an explicit Analyze/Retry so a user action never waits behind
  // invisible background work.
  useEffect(() => {
    if (!analysisService || typeof analysisService.reconcileOrphans !== 'function') {
      return;
    }
    void analysisService.reconcileOrphans!();
  }, [analysisService]);

  /** Run/resume/retry the tactics scan of one game (WP-A on-demand scan). */
  const runScan = useCallback(
    (gameId: string) => {
      const service = analysisService;
      if (!service || typeof service.scanGame !== 'function') {
        return;
      }
      void (async () => {
        try {
          const outcome = await service.scanGame!(gameId);
          if (outcome === 'started') {
            setActiveDetectionIds((previous) => {
              if (previous.has(gameId)) {
                return previous;
              }
              const next = new Set(previous);
              next.add(gameId);
              return next;
            });
            justStartedScans.current = new Set(justStartedScans.current).add(gameId);
          } else {
            // Not (or no longer) running: drop the optimistic state; when the
            // pass already completed the next rows reload shows its real count.
            setActiveDetectionIds((previous) => {
              if (!previous.has(gameId)) {
                return previous;
              }
              const next = new Set(previous);
              next.delete(gameId);
              return next;
            });
            justStartedScans.current = new Set(
              [...justStartedScans.current].filter((id) => id !== gameId),
            );
            if (outcome === 'already-completed') {
              library.reload();
            }
          }
        } catch {
          // The next poll reconciles the real registry state.
        }
      })();
    },
    [analysisService, library],
  );

  const canScan = analysisService !== null && typeof analysisService.scanGame === 'function';
  const canCancelScan =
    analysisService !== null && typeof analysisService.cancelScan === 'function';

  /** Run/resume/retry the Feature-011 puzzle-generation pass of one game
   *  (engine-free derived data; mirrors `runScan` optimistically). */
  const runGeneration = useCallback(
    (gameId: string) => {
      const service = analysisService;
      if (!service || typeof service.generatePuzzles !== 'function') {
        return;
      }
      void (async () => {
        try {
          const outcome = await service.generatePuzzles!(gameId);
          if (outcome === 'started') {
            setActiveGenerationIds((previous) => {
              if (previous.has(gameId)) {
                return previous;
              }
              const next = new Set(previous);
              next.add(gameId);
              return next;
            });
            justStartedGenerations.current = new Set(justStartedGenerations.current).add(gameId);
          } else {
            // Not (or no longer) running: drop the optimistic state; when the
            // pass already completed the next rows reload shows its real count.
            setActiveGenerationIds((previous) => {
              if (!previous.has(gameId)) {
                return previous;
              }
              const next = new Set(previous);
              next.delete(gameId);
              return next;
            });
            justStartedGenerations.current = new Set(
              [...justStartedGenerations.current].filter((id) => id !== gameId),
            );
            if (outcome === 'already-current') {
              library.reload();
            }
          }
        } catch {
          // The next poll reconciles the real registry state.
        }
      })();
    },
    [analysisService, library],
  );

  const canGenerate =
    analysisService !== null && typeof analysisService.generatePuzzles === 'function';

  /** Whole-library engine activity that survives navigation: live analysis
   *  jobs (this session) plus live tactics scans. Paused jobs (earlier
   *  session) are never shown as busy. */
  const busyAnalysisRows = shownRows.filter((row) => {
    const status = analysis.statuses[row.id];
    return (status === 'queued' || status === 'inProgress') && liveAnalysisIds.has(row.id);
  });
  const busyScanIds = [...activeDetectionIds].filter((id) =>
    library.rows.some((row) => row.id === id),
  );
  const engineBusy = analysis.running || busyAnalysisRows.length > 0 || busyScanIds.length > 0;

  /** Persistent engine-activity line (non-running branch): resumed analysis
   *  jobs + live tactics scans, so a queued/scanning game is never silent. */
  let busyDone = 0;
  let busyTotal = 0;
  for (const row of busyAnalysisRows) {
    const progress = analysis.perGameProgress[row.id];
    if (progress && progress.totalPositions > 0) {
      busyDone += progress.completedPositions;
      busyTotal += progress.totalPositions;
    }
  }
  const busyParts: string[] = [];
  if (busyAnalysisRows.length > 0) {
    const label =
      busyAnalysisRows.length === 1
        ? '1 game is analyzing'
        : `${busyAnalysisRows.length} games are analyzing`;
    busyParts.push(label);
    if (busyTotal > 0) {
      busyParts.push(`${busyDone}/${busyTotal} positions`);
    }
  }
  if (busyScanIds.length > 0) {
    const scanPart =
      busyScanIds.length === 1
        ? '1 tactics scan running'
        : `${busyScanIds.length} tactics scans running`;
    busyParts.push(scanPart);
    // Plan-013 W3: surface the live numeric progress of the running scans
    // (settled candidates over total) from the persisted summaries.
    let scanDone = 0;
    let scanTotal = 0;
    for (const id of busyScanIds) {
      const row = library.rows.find((candidate) => candidate.id === id);
      const progress = row?.scanProgress;
      if (progress && progress.total > 0) {
        scanDone += progress.done;
        scanTotal += progress.total;
      }
    }
    if (scanTotal > 0) {
      busyParts.push(`${scanDone}/${scanTotal} candidates verified`);
    }
  }
  const busyLine = busyParts.length > 0 ? busyParts.join(' · ') : 'Engine work is running…';

  // Warn before the tab closes while engine work is live (analysis jobs / scan
  // passes are resumable — the user can keep them or resume them later).
  useCloseInterruptGuard(
    engineBusy,
    'Engine analysis or a tactics scan is running. Leaving now pauses it for later (resumable).',
  );

  /** Cancel every visible piece of engine work: persisted analysis jobs of the
   *  displayed rows and any live tactics scans. */
  const cancelBusyWork = useCallback(() => {
    for (const row of busyAnalysisRows) {
      analysis.cancelGame(row.id);
    }
    if (canCancelScan) {
      for (const id of busyScanIds) {
        void analysisService!.cancelScan!(id);
      }
    }
    library.reload();
  }, [busyAnalysisRows, busyScanIds, canCancelScan, analysisService, analysis, library]);

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
            // Route every actionable selected game through the analysis queue:
            // a game without a current run is analyzed, and a game whose run is
            // completed/outdated is force re-analyzed (the per-row Re-analyze
            // behaviour). A silent no-op for already-analyzed selections would
            // otherwise drop the selection without queueing anything. Games
            // already queued or running in this session are left alone.
            const selected = [...library.selected.ids];
            const reanalyze: string[] = [];
            const analyze: string[] = [];
            for (const id of selected) {
              if (analysis.inQueue.has(id)) {
                continue;
              }
              const status = analysis.statuses[id];
              if (status === 'completed' || status === 'outdated') {
                reanalyze.push(id);
              } else {
                analyze.push(id);
              }
            }
            if (analyze.length > 0) {
              analysis.analyze(analyze);
            }
            if (reanalyze.length > 0) {
              analysis.reanalyzeMany(reanalyze);
            }
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
        <div className={styles.progress} data-testid="library-progress" aria-live="polite">
          <span className={styles.progressText} data-testid="library-progress-line">
            {analysis.progressLine}
            {analysis.queuedNote ? (
              <span className={styles.progressNote} data-testid="library-queued-note">
                {' '}
                · {analysis.queuedNote}
              </span>
            ) : null}
          </span>
          {analysis.positions ? <QueueProgressBar positions={analysis.positions} /> : null}
          <Button
            variant="ghost"
            className={styles.cancelInline!}
            data-testid="library-analyze-cancel"
            onClick={() => analysis.cancel()}
            title="Cancel the running analysis and remove queued games"
          >
            Cancel analysis
          </Button>
        </div>
      ) : null}

      {engineBusy && !analysis.running ? (
        <div className={styles.progress} data-testid="library-engine-busy" aria-live="polite">
          <span className={styles.progressText} data-testid="library-engine-busy-line">
            {busyLine}
          </span>
          <Button
            variant="ghost"
            className={styles.cancelInline!}
            data-testid="library-engine-busy-cancel"
            onClick={cancelBusyWork}
            title="Cancel the resumed analysis jobs and any running tactics scans"
          >
            Cancel work
          </Button>
        </div>
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
            activeDetectionIds={activeDetectionIds}
            activeGenerationIds={activeGenerationIds}
            liveAnalysisIds={liveAnalysisIds}
            scanEnabled={canScan && analysis.enabled}
            onScan={runScan}
            generationEnabled={canGenerate && analysis.enabled}
            onGeneratePuzzles={runGeneration}
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
  activeDetectionIds,
  activeGenerationIds,
  liveAnalysisIds,
  scanEnabled,
  onScan,
  generationEnabled,
  onGeneratePuzzles,
  onDeleteGame,
}: {
  rows: readonly LibraryGameRow[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  analysis: LibraryAnalysisApi | null;
  statuses: Readonly<Record<string, GameAnalysisStatus>>;
  /** Game ids whose Feature-010 detection pass is live in this session. */
  activeDetectionIds: ReadonlySet<string>;
  /** Game ids whose Feature-011 puzzle-generation pass is live in this session. */
  activeGenerationIds: ReadonlySet<string>;
  /** Game ids whose analysis job is live in this session (not paused). */
  liveAnalysisIds: ReadonlySet<string>;
  /** Whether the shared service exposes the on-demand scan entry point. */
  scanEnabled: boolean;
  onScan: (gameId: string) => void;
  /** Whether the shared service exposes the on-demand generation entry point. */
  generationEnabled: boolean;
  onGeneratePuzzles: (gameId: string) => void;
  onDeleteGame: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      className={`${styles.table} ${analysis ? styles.withAnalysis : ''}`}
      role="table"
      aria-label="Imported games"
      data-testid="library-rows"
    >
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

          {/* Lichess-style card body: players + result line, then the meta line. */}
          <span role="cell" className={styles.rowBody}>
            <span className={styles.playersLine}>
              <PlayerName
                name={row.whiteName}
                rating={row.whiteRating}
                isYou={row.userColor === 'white'}
                testId="game-white"
              />
              <span aria-hidden="true" className={styles.vsToken}>
                vs
              </span>
              <PlayerName
                name={row.blackName}
                rating={row.blackRating}
                isYou={row.userColor === 'black'}
                testId="game-black"
              />
              <span data-testid="game-result" className={styles.resultCell}>
                <ResultChip result={row.result} userColor={row.userColor} />
              </span>
            </span>
            <GameRowMeta row={row} />
          </span>

          {analysis ? (
            <span
              role="cell"
              data-testid={`game-analysis-${row.id}`}
              data-status={statuses[row.id] ?? 'unanalyzed'}
              className={styles.analysisCell}
            >
              <AnalysisCell
                gameId={row.id}
                status={statuses[row.id] ?? 'unanalyzed'}
                paused={
                  ((statuses[row.id] ?? 'unanalyzed') === 'queued' ||
                    (statuses[row.id] ?? 'unanalyzed') === 'inProgress') &&
                  !liveAnalysisIds.has(row.id) &&
                  !analysis.inQueue.has(row.id)
                }
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
          <GameRowInsights
            row={row}
            detectionRunning={activeDetectionIds.has(row.id)}
            generationRunning={activeGenerationIds.has(row.id)}
          />
          <DetectionScanAction
            row={row}
            live={activeDetectionIds.has(row.id)}
            enabled={scanEnabled}
            onScan={onScan}
          />
          <PuzzleGenerationAction
            row={row}
            live={activeGenerationIds.has(row.id)}
            enabled={generationEnabled}
            onGenerate={onGeneratePuzzles}
          />
          {scanProgressVisible(row, activeDetectionIds.has(row.id)) ? (
            <RowScanProgressBar gameId={row.id} progress={row.scanProgress!} />
          ) : null}
          {puzzleProgressVisible(row, activeGenerationIds.has(row.id)) ? (
            <RowPuzzleProgressBar gameId={row.id} progress={row.puzzleProgress!} />
          ) : null}
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
  testId,
}: {
  name: string;
  rating: number | null;
  isYou: boolean;
  testId?: string;
}): React.JSX.Element {
  return (
    <span className={styles.playerCell} data-testid={testId}>
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

/** Second, full-width row line: date · platform · time control · side · end. */
function GameRowMeta({ row }: { row: LibraryGameRow }): React.JSX.Element | null {
  const parts: Array<{ key: string; testId?: string; text: string }> = [];
  const date = formatDate(row.playedAt);
  if (date !== '—') {
    parts.push({ key: 'date', testId: 'game-date', text: date });
  }
  parts.push({ key: 'source', testId: 'game-source', text: GAME_SOURCE_LABELS[row.source] });
  const control = parseTimeControl(row.timeControl).display;
  parts.push({
    key: 'time',
    testId: 'game-timecontrol',
    text: `${control} · ${row.normalizedTimeControl}`,
  });
  parts.push({ key: 'side', testId: 'game-side', text: row.userColor });
  if (row.moveCount > 0 || row.result !== '*') {
    const effective = row.termination ?? fallbackTermination(row.result);
    const end: string[] = [terminationLabel(effective)];
    if (row.moveCount > 0) {
      end.push(`${row.moveCount} ${row.moveCount === 1 ? 'move' : 'moves'}`);
    }
    parts.push({ key: 'end', text: end.join(' · ') });
  }
  if (parts.length === 0) {
    return null;
  }
  return (
    <div className={styles.rowMeta} data-testid={`game-meta-${row.id}`}>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 ? (
            <span aria-hidden="true" className={styles.separator}>
              {' '}
              ·{' '}
            </span>
          ) : null}
          <span data-testid={part.testId}>{part.text}</span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One presentable statistics value of the row insights strip. `text` is the
 * visible form; `spoken` spells it out for the labelled region's
 * screen-reader sentence; `color` (optional) tints the count value.
 */
interface RowInsightItem {
  readonly key: string;
  readonly testId: string;
  readonly text: string;
  readonly spoken: string;
  readonly color?: string;
  /** Hover/help text for state that needs an explanation (e.g. interrupted). */
  readonly title?: string;
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
 * Accuracy is shown with one decimal; counts are tinted by classification
 * (zero → green for the negative classes, neutral for best/good). Feature-011
 * puzzle data follows the same absent-vs-zero discipline and is rendered only
 * once the detection pass completed at the current version: a stale completed
 * detection (plan-015 freshness gate / plan R-6) suppresses the puzzle notes
 * with the Feature-010 "out of date" note, and an interrupted pass never reads
 * as "generating…" (`generationRunning` = live in this session). The Feature-014
 * `Mastered N` aggregate follows the same absent-vs-zero discipline and is
 * rendered read-only (no action) whenever the row carries a real count.
 */
function rowInsightItemsFor(
  row: LibraryGameRow,
  detectionRunning: boolean,
  generationRunning: boolean,
): readonly RowInsightItem[] {
  if (row.analysisStatus !== 'completed' && row.analysisStatus !== 'outdated') {
    return [];
  }
  const items: RowInsightItem[] = [];
  if (typeof row.accuracy === 'number') {
    items.push({
      key: 'accuracy',
      testId: 'row-insights-accuracy',
      text: `Accuracy ${formatAccuracy(row.accuracy)}%`,
      spoken: `Accuracy ${formatAccuracy(row.accuracy)} per cent`,
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
        color: classificationCountColor(meta.countKey, count),
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
      color: missedTacticCountColor(count),
    });
  } else {
    // A completed analysis that has not finished a detection pass is never
    // presented as a real zero: the strip says so explicitly. A queued or
    // in-progress summary only reads "scanning…" when the game's pass is live
    // in this session (`detectionRunning`); otherwise the pass was interrupted
    // (an earlier session or a cancelled run) and the truthful state is shown.
    const detection = row.detectionState;
    const muted = 'var(--color-fg-muted, #6b7280)';
    if (detection === 'queued' || detection === 'inProgress') {
      if (detectionRunning) {
        items.push({
          key: 'detection',
          testId: 'row-insights-detection-pending',
          text: 'Tactics scan in progress…',
          spoken: 'Tactics scan in progress',
          color: muted,
        });
      } else {
        items.push({
          key: 'detection',
          testId: 'row-insights-detection-interrupted',
          text: 'Tactics scan interrupted',
          spoken: 'Tactics scan interrupted',
          title:
            'A tactics scan was started but never finished. Use Resume tactics scan below to continue it.',
          color: 'var(--color-danger, #c4261c)',
        });
      }
    } else if (detection === 'failed') {
      items.push({
        key: 'detection',
        testId: 'row-insights-detection-failed',
        text: 'Tactics scan failed',
        spoken: 'Tactics scan failed',
        color: 'var(--color-danger, #c4261c)',
      });
    } else if (detection === 'absent') {
      items.push({
        key: 'detection',
        testId: 'row-insights-detection-absent',
        text: 'Tactics not scanned',
        spoken: 'Tactics not scanned',
        color: muted,
      });
    } else if (detection === 'completed') {
      // A completed result from an older pipeline version is outdated (plan 015
      // freshness gate): its count is suppressed and the strip says so.
      items.push({
        key: 'detection',
        testId: 'row-insights-detection-outdated',
        text: 'Tactics scan out of date',
        spoken: 'Tactics scan out of date',
        title:
          'This tactics scan used an older version. Use Refresh tactics scan below to update it.',
        color: 'var(--color-warning, #b7791f)',
      });
    }
  }
  // Feature-011 puzzle surface (absent-vs-zero contract). Runs only for a
  // current completed detection (`hasCompletedDetection`): a stale completed
  // detection (plan R-6) or a detection pass that has not completed leaves the
  // Feature-010 detection note above as the sole truth — no puzzle item.
  if (row.hasCompletedDetection === true) {
    const muted = 'var(--color-fg-muted, #6b7280)';
    const puzzle = row.puzzleState ?? 'absent';
    if (puzzle === 'completed') {
      // A completed generation pass always carries a real count (zero reads
      // green via the canonical zero-rule palette) — never exposed otherwise.
      if (typeof row.puzzleCount === 'number') {
        const count = row.puzzleCount;
        items.push({
          key: 'puzzles',
          testId: 'row-insights-puzzles',
          text: `Puzzles ${count}`,
          spoken: spokenCount(count, 'puzzle', 'puzzles'),
          color: puzzleCountColor(count),
        });
      }
      // A completed pass from an older generator version is outdated: its rows
      // stay visible and immutable, and the strip says the pass can be
      // regenerated (engine-free) to add the newer puzzle kinds.
      if (row.puzzleGeneratorVersion !== PUZZLE_GENERATOR_VERSION) {
        const outdated = 'Puzzle generation is from an older generator';
        items.push({
          key: 'puzzlesOutdated',
          testId: 'row-insights-puzzles-outdated',
          text: `${outdated} — regenerate to add one-move blunder puzzles.`,
          spoken: `${outdated}. Regenerate to add one-move blunder puzzles.`,
          title: `${outdated}. Regenerate puzzles to add one-move blunder puzzles.`,
          color: 'var(--color-warning, #b7791f)',
        });
      }
    } else if (generationRunning) {
      // A pass that is live in this session — even one whose persisted state
      // has not yet advanced past `absent` (the pass just started) — reads
      // "generating", never a stale/not-yet-written note.
      items.push({
        key: 'puzzles',
        testId: 'row-insights-puzzles-pending',
        text: 'Generating puzzles…',
        spoken: 'Generating puzzles',
        color: muted,
      });
    } else if (puzzle === 'absent') {
      items.push({
        key: 'puzzles',
        testId: 'row-insights-puzzles-absent',
        text: 'Puzzles not generated',
        spoken: 'Puzzles not generated',
        title:
          'No puzzle-generation pass has run for this analysis. Use Generate puzzles below to create them.',
        color: muted,
      });
    } else if (puzzle === 'queued' || puzzle === 'inProgress') {
      items.push({
        key: 'puzzles',
        testId: 'row-insights-puzzles-interrupted',
        text: 'Puzzle generation interrupted',
        spoken: 'Puzzle generation interrupted',
        title:
          'A puzzle-generation pass was started but never finished. Use Resume puzzle generation below to continue it.',
        color: 'var(--color-danger, #c4261c)',
      });
    } else if (puzzle === 'failed') {
      items.push({
        key: 'puzzles',
        testId: 'row-insights-puzzles-failed',
        text: 'Puzzle generation failed',
        spoken: 'Puzzle generation failed',
        color: 'var(--color-danger, #c4261c)',
      });
    }
  }
  // Feature-014 mastered-puzzle aggregate (read-only): a real number (zero
  // included) reads as `Mastered N` with the canonical zero-green palette;
  // absent (no attempt rows / no loaded count) renders nothing — never a fake
  // zero. Mastery is analysis-independent, so this is outside the detection
  // gate above.
  if (typeof row.masteredPuzzleCount === 'number') {
    const count = row.masteredPuzzleCount;
    items.push({
      key: 'mastered',
      testId: 'row-insights-mastered',
      text: `Mastered ${count}`,
      spoken: spokenCount(count, 'mastered puzzle', 'mastered puzzles'),
      color: puzzleCountColor(count),
    });
  }
  return items;
}

/**
 * Full-width insights line under a row's meta: Accuracy · Blunders ·
 * Mistakes · Inaccuracies · Missed tactics · Puzzles · Mastered for the user's
 * latest completed analysis. One labelled region per row whose screen-reader
 * text spells out every value.
 */
function GameRowInsights({
  row,
  detectionRunning,
  generationRunning,
}: {
  row: LibraryGameRow;
  detectionRunning: boolean;
  /** True while the row's Feature-011 generation pass is live this session. */
  generationRunning: boolean;
}): React.JSX.Element | null {
  const items = rowInsightItemsFor(row, detectionRunning, generationRunning);
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
          <span
            data-testid={item.testId}
            style={item.color ? { color: item.color } : undefined}
            {...(item.title !== undefined ? { title: item.title } : {})}
          >
            {item.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * On-demand scan affordance under a row (WP-A): resume an interrupted/paused
 * pass, retry a failed pass, or run the first scan of an analysis that predates
 * detection. Absent (never "scanning" twice) while the pass is live.
 */
function DetectionScanAction({
  row,
  live,
  enabled,
  onScan,
}: {
  row: LibraryGameRow;
  live: boolean;
  enabled: boolean;
  onScan: (gameId: string) => void;
}): React.JSX.Element | null {
  if (row.analysisStatus !== 'completed' && row.analysisStatus !== 'outdated') {
    return null;
  }
  const detection = row.detectionState;
  let kind: 'resume' | 'retry' | 'run' | 'refresh' | null = null;
  let label = '';
  if (detection === 'queued' || detection === 'inProgress') {
    if (live) {
      return null; // The strip already shows "Tactics scan in progress…".
    }
    kind = 'resume';
    label = 'Resume tactics scan';
  } else if (detection === 'failed') {
    kind = 'retry';
    label = 'Retry tactics scan';
  } else if (detection === 'absent') {
    kind = 'run';
    label = 'Run tactics scan';
  } else if (detection === 'completed' && row.detectionVersion !== DETECTION_VERSION) {
    // Outdated result from an older pipeline version (plan 015): offer a
    // refresh scan that re-runs detection without re-analyzing the game.
    kind = 'refresh';
    label = 'Refresh tactics scan';
  } else {
    return null;
  }
  if (!enabled || !kind) {
    return null;
  }
  return (
    <span className={styles.detectionScan}>
      <button
        type="button"
        className={styles.detectionScanButton}
        data-testid={`row-scan-${kind}-${row.id}`}
        onClick={() => onScan(row.id)}
      >
        {label}
      </button>
    </span>
  );
}

/**
 * On-demand puzzle-generation affordance under a row (Feature 011, mirror of
 * `DetectionScanAction`): run the first generation pass of an analysis whose
 * detection completed at the current version but whose puzzles were never
 * generated, resume an interrupted pass, retry a failed one, or **regenerate**
 * a completed pass from an older generator version (engine-free — adds the
 * rows the newer generator produces, e.g. one-move blunder puzzles). Rendered
 * only while detection is completed/fresh — a stale completed detection offers
 * the Feature-010 refresh-scan instead. Absent (never "generating" twice)
 * while the pass is live; the live strip note governs.
 */
function PuzzleGenerationAction({
  row,
  live,
  enabled,
  onGenerate,
}: {
  row: LibraryGameRow;
  live: boolean;
  enabled: boolean;
  onGenerate: (gameId: string) => void;
}): React.JSX.Element | null {
  if (row.analysisStatus !== 'completed' && row.analysisStatus !== 'outdated') {
    return null;
  }
  if (row.hasCompletedDetection !== true) {
    return null;
  }
  if (live) {
    return null; // The strip already shows "Generating puzzles…".
  }
  const puzzle = row.puzzleState ?? 'absent';
  let kind: 'generate' | 'resume' | 'retry' | 'regenerate' | null = null;
  let label = '';
  if (puzzle === 'queued' || puzzle === 'inProgress') {
    kind = 'resume';
    label = 'Resume puzzle generation';
  } else if (puzzle === 'failed') {
    kind = 'retry';
    label = 'Retry puzzle generation';
  } else if (puzzle === 'absent') {
    kind = 'generate';
    label = 'Generate puzzles';
  } else if (puzzle === 'completed' && row.puzzleGeneratorVersion !== PUZZLE_GENERATOR_VERSION) {
    // Outdated completed pass (older generator): an engine-free re-run adds
    // the newer rows without touching the immutable ones.
    kind = 'regenerate';
    label = 'Regenerate puzzles';
  } else {
    return null;
  }
  if (!enabled || !kind) {
    return null;
  }
  return (
    <span className={styles.detectionScan}>
      <button
        type="button"
        className={styles.detectionScanButton}
        data-testid={`row-puzzles-${kind}-${row.id}`}
        onClick={() => onGenerate(row.id)}
      >
        {label}
      </button>
    </span>
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
  paused,
}: {
  gameId: string;
  status: GameAnalysisStatus;
  progress?: GameAnalysisProgress;
  /** True when the job was left paused by an earlier session (not live). */
  paused?: boolean;
}): React.JSX.Element | null {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const meta = STATUS_BADGES[status];
  if (!meta) {
    return null;
  }
  const open = hover || pinned;
  const pausedInfo =
    'Paused — this analysis was left by an earlier session. Resume it or cancel it.';
  const detail = paused
    ? pausedInfo
    : status === 'inProgress' && progress && progress.totalPositions > 0
      ? `${meta.info} ${progress.completedPositions}/${progress.totalPositions} positions.`
      : meta.info;
  const label = paused ? 'Paused' : STATUS_LABELS[status];
  return (
    <span className={styles.statusBadgeWrap}>
      <button
        type="button"
        className={`${styles.statusBadge} ${styles[`statusBadge${meta.tone}`]}`}
        data-testid={`game-status-${gameId}`}
        aria-expanded={open}
        aria-label={`${label}: ${detail}`}
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
  paused,
  onRun,
  onReanalyze,
  onCancelGame,
  onDelete,
}: {
  gameId: string;
  status: GameAnalysisStatus;
  /** Live per-game progress for a queued/in-progress job, when available. */
  progress?: GameAnalysisProgress;
  /** True when this queued/in-progress job was left by an earlier session. */
  paused?: boolean;
  /** Run an analysis for this game (Analyze / Retry / Resume). */
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
          <Link
            className={styles.rowReviewLink}
            data-testid={`game-puzzles-${gameId}`}
            to={`/games/${gameId}/puzzles`}
            aria-label="Puzzles from this game"
            title="Puzzles from this game"
          >
            <span aria-hidden="true" className={styles.reviewGlyph}>
              {PUZZLES_GLYPH}
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

      {showActive && paused ? (
        <IconButton
          label="Resume analysis"
          dataTestId={`game-resume-${gameId}`}
          className={styles.rowAction!}
          onClick={() => onRun(gameId)}
        >
          <RefreshIcon />
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
      <RowStatusBadge
        gameId={gameId}
        status={status}
        {...(paused !== undefined ? { paused } : {})}
        {...(progress ? { progress } : {})}
      />
    </span>
  );
}

/**
 * Top-of-list queue progress: one bar over the aggregate positions of every
 * game currently in the analysis queue, with the percentage spelled out.
 */
function QueueProgressBar({ positions }: { positions: AnalysisQueuePositions }): React.JSX.Element {
  const percent = positions.total > 0 ? Math.round((positions.done / positions.total) * 100) : 0;
  return (
    <div
      className={styles.queueProgress}
      data-testid="library-progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Analysis queue: ${positions.done} of ${positions.total} positions, ${percent} per cent`}
    >
      <span className={styles.rowProgressTrack}>
        <span
          className={styles.rowProgressFill}
          style={{ width: `${percent}%` }}
          data-testid="library-progress-fill"
        />
      </span>
      <span className={styles.rowProgressText} data-testid="library-progress-percent">
        {positions.done}/{positions.total} positions · {percent}%
      </span>
    </div>
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

/**
 * True when a row should show the distinct-colour tactics-scan progress bar:
 * the pass is genuinely running **in this session** and the persisted summary
 * has recorded a Stage-2 total. An interrupted pass never claims progress.
 */
function scanProgressVisible(row: LibraryGameRow, live: boolean): boolean {
  if (!live) {
    return false;
  }
  if (row.detectionState !== 'queued' && row.detectionState !== 'inProgress') {
    return false;
  }
  const progress = row.scanProgress;
  return progress !== null && progress !== undefined && progress.total > 0;
}

/**
 * Plan-013 W3: full-width scan progress strip under a row whose detection pass
 * is running right now. Same bar shape as the analysis progress bar, visually
 * distinct in the canonical missed-tactic magenta, with the numbers spelled out
 * for assistive tech ("Verifying tactic X of Y").
 */
function RowScanProgressBar({
  gameId,
  progress,
}: {
  gameId: string;
  progress: { readonly done: number; readonly total: number };
}): React.JSX.Element {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div
      className={`${styles.rowProgressBar} ${styles.scanProgressBar}`}
      data-testid={`game-scan-progress-${gameId}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Verifying tactic ${progress.done} of ${progress.total}, ${percent} per cent`}
    >
      <span className={styles.rowProgressTrack}>
        <span
          className={`${styles.rowProgressFill} ${styles.scanProgressFill}`}
          style={{ width: `${percent}%` }}
          data-testid={`game-scan-progress-fill-${gameId}`}
        />
      </span>
      <span className={styles.rowProgressText} data-testid={`game-scan-progress-text-${gameId}`}>
        Verifying tactic {progress.done} of {progress.total} · {percent}%
      </span>
    </div>
  );
}

/**
 * True when a row should show the Feature-011 puzzle-generation progress bar:
 * the pass is genuinely running **in this session** and the persisted summary
 * has recorded a total. An interrupted pass never claims progress (spec
 * Accessibility: interrupted passes never announce progress).
 */
function puzzleProgressVisible(row: LibraryGameRow, live: boolean): boolean {
  if (!live) {
    return false;
  }
  if (row.puzzleState !== 'queued' && row.puzzleState !== 'inProgress') {
    return false;
  }
  const progress = row.puzzleProgress;
  return progress !== null && progress !== undefined && progress.total > 0;
}

/**
 * Feature-011 Stage D: full-width generation-progress strip under a row whose
 * puzzle-generation pass is running right now. Same bar shape as the scan
 * strip, visually distinct (amber rule/fill — derived data, not engine work),
 * with the numbers spelled out for assistive tech ("Generating puzzle X of Y").
 */
function RowPuzzleProgressBar({
  gameId,
  progress,
}: {
  gameId: string;
  progress: { readonly done: number; readonly total: number };
}): React.JSX.Element {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div
      className={`${styles.rowProgressBar} ${styles.puzzleProgressBar}`}
      data-testid={`game-puzzle-progress-${gameId}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Generating puzzle ${progress.done} of ${progress.total}, ${percent} per cent`}
    >
      <span className={styles.rowProgressTrack}>
        <span
          className={`${styles.rowProgressFill} ${styles.puzzleProgressFill}`}
          style={{ width: `${percent}%` }}
          data-testid={`game-puzzle-progress-fill-${gameId}`}
        />
      </span>
      <span className={styles.rowProgressText} data-testid={`game-puzzle-progress-text-${gameId}`}>
        Generating puzzle {progress.done} of {progress.total} · {percent}%
      </span>
    </div>
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
