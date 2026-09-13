import type * as React from 'react';
import {
  LIBRARY_PLATFORMS,
  TIME_FRAME_PRESETS,
  isCustomTimeFrame,
  presetTimeFrame,
  type GameLibraryFilters,
  type NonCustomTimeFramePreset,
} from '@/domain/gameLibrary';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import { Button } from '@/components/ui/Button';
import { SearchIcon } from '@/components/ui/icons';
import styles from './GameLibraryToolbar.module.css';

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

const TIME_CONTROL_LABELS: Readonly<Record<string, string>> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Correspondence',
  unknown: 'Other',
};

export interface GameLibraryToolbarProps {
  readonly filters: GameLibraryFilters;
  readonly timeFrameError: string | null;
  readonly isFiltering: boolean;
  onFilters(patch: Partial<GameLibraryFilters>, replace?: boolean): void;
  onClearFilters(): void;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Single consolidated Library header: filter selects on the first row, search
 * (+ clear/import) on the second. Bulk selection actions live in the results-row
 * selection bar (Feature 017 §5), not here.
 */
export function GameLibraryToolbar({
  filters,
  timeFrameError,
  isFiltering,
  onFilters,
  onClearFilters,
}: GameLibraryToolbarProps): React.JSX.Element {
  const custom = isCustomTimeFrame(filters.timeFrame) ? filters.timeFrame : null;

  return (
    <div className={styles.toolbar} data-testid="library-toolbar">
      <div className={styles.filterRow}>
        <div className={styles.filters}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Time</span>
            <select
              data-testid="filter-time"
              aria-label="Time range"
              value={filters.timeFrame.preset}
              onChange={(e) => {
                const preset = e.target.value;
                if (preset === 'custom') {
                  onFilters({ timeFrame: { preset: 'custom', from: '', to: '' } });
                } else {
                  onFilters({
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

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Time ctrl</span>
            <select
              data-testid="filter-timecontrol"
              aria-label="Time control"
              value={filters.timeControl}
              onChange={(e) =>
                onFilters({ timeControl: e.target.value as GameLibraryFilters['timeControl'] })
              }
            >
              <option value="all">All</option>
              {TIME_CONTROL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {TIME_CONTROL_LABELS[category] ?? capitalize(category)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Side</span>
            <select
              data-testid="filter-side"
              aria-label="Your side"
              value={filters.side}
              onChange={(e) => onFilters({ side: e.target.value as GameLibraryFilters['side'] })}
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
              aria-label="Platform"
              value={filters.platform}
              onChange={(e) =>
                onFilters({ platform: e.target.value as GameLibraryFilters['platform'] })
              }
            >
              <option value="all">All</option>
              {LIBRARY_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {GAME_SOURCE_LABELS[platform]}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Analysis</span>
            <select
              data-testid="filter-analysis"
              aria-label="Analysis"
              value={filters.analysis}
              onChange={(e) =>
                onFilters({ analysis: e.target.value as GameLibraryFilters['analysis'] })
              }
            >
              <option value="all">All</option>
              <option value="analyzed">Analyzed</option>
              <option value="notAnalyzed">Not analyzed</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Has blunders</span>
            <select
              data-testid="filter-has-blunders"
              aria-label="Has blunders"
              value={filters.hasBlunders}
              onChange={(e) =>
                onFilters({ hasBlunders: e.target.value as GameLibraryFilters['hasBlunders'] })
              }
            >
              <option value="all">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Has missed tactics</span>
            <select
              data-testid="filter-has-missed-tactics"
              aria-label="Has missed tactics"
              value={filters.hasMissedTactics}
              onChange={(e) =>
                onFilters({
                  hasMissedTactics: e.target.value as GameLibraryFilters['hasMissedTactics'],
                })
              }
            >
              <option value="all">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        {custom ? (
          <div className={styles.customRange} data-testid="filter-custom-range">
            <input
              type="date"
              aria-label="Start date"
              data-testid="filter-date-from"
              value={custom.from}
              onChange={(e) => onFilters({ timeFrame: { ...custom, from: e.target.value } })}
            />
            <span aria-hidden="true">→</span>
            <input
              type="date"
              aria-label="End date"
              data-testid="filter-date-to"
              value={custom.to}
              onChange={(e) => onFilters({ timeFrame: { ...custom, to: e.target.value } })}
            />
            {timeFrameError ? (
              <span className={styles.error} role="alert">
                {timeFrameError}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.searchRow}>
        <label className={styles.searchField}>
          <span className={styles.srOnly}>Search games</span>
          <span className={styles.searchIcon} aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            data-testid="library-search"
            value={filters.search}
            onChange={(e) => onFilters({ search: e.target.value }, true)}
            placeholder="Search games by player or game id…"
            autoComplete="off"
          />
        </label>
        {filters.search !== '' ? (
          <Button
            variant="ghost"
            className={styles.clearButton!}
            data-testid="library-search-clear"
            onClick={() => onFilters({ search: '' }, true)}
          >
            Clear
          </Button>
        ) : null}
        {isFiltering ? (
          <Button
            variant="ghost"
            className={styles.clearButton!}
            data-testid="filter-clear-all"
            onClick={onClearFilters}
          >
            Reset filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
