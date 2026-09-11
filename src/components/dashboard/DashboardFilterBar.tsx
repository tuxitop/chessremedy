import type * as React from 'react';
import {
  LIBRARY_PLATFORMS,
  TIME_FRAME_PRESETS,
  isCustomTimeFrame,
  presetTimeFrame,
  type GameLibraryFilters,
  type NonCustomTimeFramePreset,
} from '@/domain/gameLibrary';
import {
  PLATFORM_LABELS,
  TIME_CONTROL_LABELS,
  TIME_CONTROL_ORDER,
  type MixedDimensions,
} from '@/presentation/dashboard';
import styles from './DashboardFilterBar.module.css';

/** Canonical time-frame labels (shared wording with the Game Library). */
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

export interface DashboardFilterBarProps {
  readonly filters: GameLibraryFilters;
  /** Inline validation hint for an invalid custom range; `null` when valid. */
  readonly hint: string | null;
  readonly mixed: MixedDimensions;
  onFilters(next: GameLibraryFilters, replace?: boolean): void;
  readonly testId?: string;
}

/**
 * Game-analysis filter bar. Reuses the canonical Game Library filter model and
 * URL codec via the `onFilters` callback (the hook owns URL persistence).
 * `search`/`side`/`result` are not surfaced. An invalid custom range shows an
 * inline hint and keeps the last valid view.
 */
export function DashboardFilterBar({
  filters,
  hint,
  mixed,
  onFilters,
  testId = 'dashboard-filter-bar',
}: DashboardFilterBarProps): React.JSX.Element {
  const custom = isCustomTimeFrame(filters.timeFrame) ? filters.timeFrame : null;

  return (
    <section className={styles.bar} aria-label="Game-analysis filters" data-testid={testId}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Platform</span>
          <select
            className={styles.select}
            data-testid="dashboard-filter-platform"
            aria-label="Platform"
            value={filters.platform}
            onChange={(event) =>
              onFilters({
                ...filters,
                platform: event.target.value as GameLibraryFilters['platform'],
              })
            }
          >
            <option value="all">All</option>
            {LIBRARY_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {PLATFORM_LABELS[platform]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Time control</span>
          <select
            className={styles.select}
            data-testid="dashboard-filter-time-control"
            aria-label="Time control"
            value={filters.timeControl}
            onChange={(event) =>
              onFilters({
                ...filters,
                timeControl: event.target.value as GameLibraryFilters['timeControl'],
              })
            }
          >
            <option value="all">All</option>
            {TIME_CONTROL_ORDER.map((category) => (
              <option key={category} value={category}>
                {TIME_CONTROL_LABELS[category]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Time range</span>
          <select
            className={styles.select}
            data-testid="dashboard-filter-time-frame"
            aria-label="Time range"
            value={filters.timeFrame.preset}
            onChange={(event) => {
              const preset = event.target.value;
              if (preset === 'custom') {
                onFilters({ ...filters, timeFrame: { preset: 'custom', from: '', to: '' } });
              } else {
                onFilters({
                  ...filters,
                  timeFrame: presetTimeFrame(preset as NonCustomTimeFramePreset),
                });
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
      </div>

      {custom !== null ? (
        <div className={styles.customRange} data-testid="dashboard-custom-range">
          <label className={styles.field}>
            <span className={styles.label}>From</span>
            <input
              className={styles.date}
              type="date"
              aria-label="Start date"
              data-testid="dashboard-date-from"
              value={custom.from}
              onChange={(event) =>
                onFilters({ ...filters, timeFrame: { ...custom, from: event.target.value } })
              }
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>To</span>
            <input
              className={styles.date}
              type="date"
              aria-label="End date"
              data-testid="dashboard-date-to"
              value={custom.to}
              onChange={(event) =>
                onFilters({ ...filters, timeFrame: { ...custom, to: event.target.value } })
              }
            />
          </label>
        </div>
      ) : null}

      {hint !== null ? (
        <p className={styles.hint} role="alert" data-testid="dashboard-filter-hint">
          {hint}
        </p>
      ) : null}

      {mixed.mixed ? (
        <p className={styles.mixed} role="note" data-testid="dashboard-mixed-note">
          Showing {formatList(mixed.labels)} separately — partitions are never combined.
        </p>
      ) : null}
    </section>
  );
}

function formatList(labels: readonly string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? 'dimensions';
  }
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
