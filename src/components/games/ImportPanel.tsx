import type * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS, type SettingsKey } from '@/config/app-config';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import {
  DEFAULT_IMPORT_FILTERS,
  IMPORT_FILTER_CATEGORIES,
  TIME_FRAME_PRESETS,
  filtersEqual,
  validateImportFilters,
  type ImportFilters,
  type ImportProvider,
  type TimeFrame,
  type TimeFramePreset,
} from '@/domain/import';
import type { ImportServiceLike } from '@/hooks/useGameImport';
import { useGameImport } from '@/hooks/useGameImport';
import { Button } from '@/components/ui/Button';
import styles from './ImportPanel.module.css';

interface ImportPanelProps {
  readonly provider: ImportProvider;
  readonly service: ImportServiceLike;
  /** Called after an import run finishes so the page can refresh its list. */
  readonly onImported: () => void;
  /** When false the panel omits its own heading (the host supplies a title). */
  readonly showHeading?: boolean;
}

function keysFor(provider: ImportProvider): {
  username: SettingsKey;
  filters: SettingsKey;
} {
  return provider === 'chesscom'
    ? { username: SETTINGS_KEYS.chessComUsername, filters: SETTINGS_KEYS.chessComFilters }
    : { username: SETTINGS_KEYS.lichessUsername, filters: SETTINGS_KEYS.lichessFilters };
}

function readStoredFilters(value: unknown): ImportFilters {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<ImportFilters>;
    if (candidate.timeFrame && candidate.timeControls) {
      const full = candidate as ImportFilters;
      if (validateImportFilters(full) === null) {
        return full;
      }
    }
  }
  return DEFAULT_IMPORT_FILTERS;
}

const PRESET_LABELS: Readonly<Record<TimeFramePreset, string>> = {
  all: 'All time',
  last30d: 'Last 30 days',
  last3m: 'Last 3 months',
  last6m: 'Last 6 months',
  last12m: 'Last 12 months',
};

export function ImportPanel({
  provider,
  service,
  onImported,
  showHeading = true,
}: ImportPanelProps): React.JSX.Element {
  const label = GAME_SOURCE_LABELS[provider];
  const keys = useMemo(() => keysFor(provider), [provider]);
  const importHook = useGameImport(service);

  const [settingsReady, setSettingsReady] = useState(false);
  const [username, setUsername] = useState('');
  const [filters, setFilters] = useState<ImportFilters>(DEFAULT_IMPORT_FILTERS);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storedUsername = await settingsRepository.get<string>(keys.username);
      const storedFilters = await settingsRepository.get<unknown>(keys.filters);
      if (cancelled) return;
      if (typeof storedUsername === 'string') {
        setUsername(storedUsername);
      }
      setFilters(readStoredFilters(storedFilters));
      setSettingsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [keys]);

  useEffect(() => {
    if (settingsReady) {
      void importHook.reload(provider, username);
    }
    // Only reflect initial load; typing is intentionally not reloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady]);

  const filterError = validateImportFilters(filters);
  const canRun = username.trim() !== '' && filterError === null && !importHook.isBusy;
  const stored = importHook.job;
  const rescanNote =
    stored !== null &&
    stored.status !== 'running' &&
    !filtersEqual(stored.filters, filters) &&
    username.trim().toLowerCase() === stored.username.toLowerCase();

  const run = async (): Promise<void> => {
    setRunError(null);
    if (importHook.isBusy || username.trim() === '') {
      return;
    }
    try {
      const finalJob = await importHook.start({
        provider,
        username,
        filters,
      });
      void settingsRepository.set(keys.username, username.trim());
      void settingsRepository.set(keys.filters, filters);
      if (finalJob.status === 'completed') {
        onImported();
      }
    } catch {
      // The hook surfaced the message in `error`; nothing else to do here.
    }
  };

  const runLabel = primaryLabel(stored, importHook.isBusy);
  const errorMessage = importHook.error ?? runError;
  const job = importHook.job;
  const customFrame = filters.timeFrame.preset === 'custom' ? filters.timeFrame : null;

  return (
    <section className={styles.panel} data-testid={`import-panel-${provider}`}>
      {showHeading ? (
        <div className={styles.header}>
          <h2 className={styles.heading}>{label}</h2>
          <p className={styles.blurb}>
            Import public {label} games by username. No engine analysis runs during an import.
          </p>
        </div>
      ) : null}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Username</span>
          <input
            data-testid={`import-username-${provider}`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => {
              if (username.trim() !== '') {
                void settingsRepository.set(keys.username, username.trim());
              }
            }}
            placeholder={`${label} username`}
            autoComplete="off"
            disabled={importHook.isBusy}
          />
        </label>

        <fieldset className={styles.fieldGroup} disabled={importHook.isBusy}>
          <legend className={styles.fieldLabel}>Time frame</legend>
          <label className={styles.field}>
            <select
              data-testid={`import-time-frame-${provider}`}
              value={timeFramePresetValue(filters.timeFrame)}
              onChange={(e) => setTimeFramePreset(filters, e.target.value, setFilters)}
            >
              {TIME_FRAME_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset]}
                </option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
          </label>
          {customFrame ? (
            <div className={styles.dateRow}>
              <input
                type="date"
                data-testid={`import-date-from-${provider}`}
                value={customFrame.from}
                onChange={(e) =>
                  setCustomRange(filters, e.target.value, customFrame.to, setFilters)
                }
                aria-label="From date"
              />
              <span aria-hidden="true">→</span>
              <input
                type="date"
                data-testid={`import-date-to-${provider}`}
                value={customFrame.to}
                onChange={(e) =>
                  setCustomRange(filters, customFrame.from, e.target.value, setFilters)
                }
                aria-label="To date"
              />
            </div>
          ) : null}
        </fieldset>

        <fieldset className={styles.fieldGroup} disabled={importHook.isBusy}>
          <legend className={styles.fieldLabel}>Time controls</legend>
          <label className={styles.check}>
            <input
              type="checkbox"
              data-testid={`import-tc-all-${provider}`}
              checked={filters.timeControls.kind === 'all'}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  timeControls: e.target.checked
                    ? { kind: 'all' }
                    : { kind: 'categories', categories: ['blitz'] },
                })
              }
            />
            <span>All time controls</span>
          </label>
          {IMPORT_FILTER_CATEGORIES.map((category) => {
            const checked =
              filters.timeControls.kind === 'categories' &&
              filters.timeControls.categories.includes(category);
            return (
              <label key={category} className={styles.check}>
                <input
                  type="checkbox"
                  data-testid={`import-tc-${category}-${provider}`}
                  checked={checked}
                  disabled={filters.timeControls.kind === 'all'}
                  onChange={() => setFilters(toggleCategory(filters, category))}
                />
                <span>{category}</span>
              </label>
            );
          })}
        </fieldset>

        {rescanNote ? (
          <p className={styles.note} data-testid={`import-rescan-note-${provider}`}>
            Changing the selection re-scans the archive. Already imported games are detected as
            duplicates and never stored twice.
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button type="submit" data-testid={`import-run-${provider}`} disabled={!canRun}>
            {importHook.isBusy ? 'Importing…' : runLabel}
          </Button>
          {importHook.isBusy ? (
            <Button
              variant="secondary"
              data-testid={`import-cancel-${provider}`}
              onClick={() => importHook.cancel()}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <div className={styles.status} data-testid={`import-status-${provider}`} aria-live="polite">
        {job ? statusText(job, importHook.isBusy) : 'No import yet.'}
      </div>
      {job ? (
        <div className={styles.counters} data-testid={`import-counters-${provider}`}>
          <span data-testid={`import-counter-inserted-${provider}`}>
            new {job.counters.inserted}
          </span>
          <span data-testid={`import-counter-duplicates-${provider}`}>
            dup {job.counters.duplicates}
          </span>
          <span data-testid={`import-counter-filtered-${provider}`}>
            filtered {job.counters.filtered}
          </span>
          <span data-testid={`import-counter-skipped-${provider}`}>
            skipped {job.counters.skipped}
          </span>
          <span data-testid={`import-counter-failed-${provider}`}>
            failed {job.counters.failed}
          </span>
        </div>
      ) : null}
      {job?.position ? (
        <p className={styles.note} data-testid={`import-progress-${provider}`}>
          Archive {job.position.current} of {job.position.total}
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" className={styles.error} data-testid={`import-error-${provider}`}>
          {errorMessage}
        </p>
      ) : null}
      {job && job.errorSamples.length > 0 ? (
        <details className={styles.errors} data-testid={`import-errors-${provider}`}>
          <summary>Per-game errors ({job.errorSamples.length})</summary>
          <ul className={styles.errorList}>
            {job.errorSamples.map((sample, index) => (
              <li key={index}>
                {sample.externalId ? `${sample.externalId}: ` : ''}
                {sample.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function primaryLabel(job: ImportHookJob | null, busy: boolean): string {
  if (busy) return 'Importing…';
  if (!job) return 'Import games';
  if (job.status === 'paused') return 'Resume';
  if (job.status === 'failed') return 'Try again';
  return 'Import games';
}

type ImportHookJob = NonNullable<ReturnType<typeof useGameImport>['job']>;

function statusText(job: ImportHookJob, busy: boolean): string {
  if (busy && job.status === 'running') {
    return `Importing ${job.username} — ${job.counters.seen} games read.`;
  }
  switch (job.status) {
    case 'running':
      return `Importing ${job.username}…`;
    case 'paused':
      return `Paused after ${job.counters.seen} games read. Resume to continue.`;
    case 'failed':
      return `Import failed after ${job.counters.seen} games read.`;
    case 'completed':
      return `Done: ${job.counters.inserted} new, ${job.counters.duplicates} duplicates, ${job.counters.failed} failed.`;
  }
}

function timeFramePresetValue(frame: TimeFrame): string {
  return frame.preset;
}

function setTimeFramePreset(
  current: ImportFilters,
  raw: string,
  update: React.Dispatch<React.SetStateAction<ImportFilters>>,
): void {
  if (raw === 'custom') {
    update({ ...current, timeFrame: { preset: 'custom', from: '', to: '' } });
    return;
  }
  const preset = raw as TimeFramePreset;
  if ((TIME_FRAME_PRESETS as readonly string[]).includes(raw)) {
    update({ ...current, timeFrame: { preset } });
  }
}

function setCustomRange(
  current: ImportFilters,
  from: string,
  to: string,
  update: React.Dispatch<React.SetStateAction<ImportFilters>>,
): void {
  update({ ...current, timeFrame: { preset: 'custom', from, to } });
}

function toggleCategory(
  current: ImportFilters,
  category: (typeof IMPORT_FILTER_CATEGORIES)[number],
): ImportFilters {
  if (current.timeControls.kind === 'all') {
    return { ...current, timeControls: { kind: 'categories', categories: [category] } };
  }
  const has = current.timeControls.categories.includes(category);
  const categories = has
    ? current.timeControls.categories.filter((c) => c !== category)
    : [...current.timeControls.categories, category];
  if (categories.length === 0) {
    return { ...current, timeControls: { kind: 'all' } };
  }
  return { ...current, timeControls: { kind: 'categories', categories } };
}
