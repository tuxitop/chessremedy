import type * as React from 'react';
import { TIME_CONTROL_CATEGORIES } from '@/domain/chess/timeControl';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import type { GameResult } from '@/domain/chess/game';
import type { Color } from 'chessops/types';
import {
  DEFAULT_GAME_LIST_FILTERS,
  type GameListFilters,
  type MultiOption,
} from './gameListFilters';
import { Button } from '@/components/ui/Button';
import styles from './GameListFiltersBar.module.css';

const IMPORT_SOURCES = ['chesscom', 'lichess'] as const;
const RESULT_LABELS: Readonly<Record<GameResult, string>> = {
  '1-0': 'White won',
  '0-1': 'Black won',
  '1/2-1/2': 'Draw',
  '*': 'Unknown',
};

interface GameListFiltersBarProps {
  readonly filters: GameListFilters;
  readonly onChange: (filters: GameListFilters) => void;
  /** Visible match count, e.g. "N of M games". */
  readonly matched: number;
  readonly total: number;
}

function toggle<T extends string>(option: MultiOption<T>, value: T): MultiOption<T> {
  if (option === 'all') {
    return [value];
  }
  const list = option as readonly T[];
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function GameListFiltersBar({
  filters,
  onChange,
  matched,
  total,
}: GameListFiltersBarProps): React.JSX.Element {
  const set = (patch: Partial<GameListFilters>): void => onChange({ ...filters, ...patch });
  const reset = (): void => onChange(DEFAULT_GAME_LIST_FILTERS);

  return (
    <div className={styles.bar} data-testid="game-list-filters">
      <label className={styles.field}>
        <span className={styles.label}>Platform</span>
        <div className={styles.chips} role="group" aria-label="Platform">
          {(['all', ...IMPORT_SOURCES] as const).map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`gfilter-source-${value}`}
              className={
                value === 'all'
                  ? filters.sources === 'all'
                    ? styles.active
                    : undefined
                  : filters.sources !== 'all' &&
                      (filters.sources as readonly string[]).includes(value)
                    ? styles.active
                    : undefined
              }
              aria-pressed={
                value === 'all'
                  ? filters.sources === 'all'
                  : filters.sources !== 'all' &&
                    (filters.sources as readonly string[]).includes(value)
              }
              onClick={() => set({ sources: toggle(filters.sources, value as never) })}
            >
              {value === 'all' ? 'All' : GAME_SOURCE_LABELS[value]}
            </button>
          ))}
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Time control</span>
        <div className={styles.chips} role="group" aria-label="Time control">
          {(['all', ...TIME_CONTROL_CATEGORIES] as const).map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`gfilter-timecontrol-${value}`}
              className={isActive(filters.timeControls, value) ? styles.active : undefined}
              aria-pressed={isActive(filters.timeControls, value)}
              onClick={() => set({ timeControls: toggle(filters.timeControls, value as never) })}
            >
              {value}
            </button>
          ))}
        </div>
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Your side</span>
          <select
            data-testid="gfilter-color"
            value={filters.colors === 'all' ? 'all' : (filters.colors[0] ?? 'all')}
            onChange={(e) => {
              const value = e.target.value;
              set({ colors: value === 'all' ? 'all' : ([value] as readonly Color[]) });
            }}
          >
            <option value="all">Any</option>
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Result</span>
          <select
            data-testid="gfilter-result"
            value={filters.results === 'all' ? 'all' : (filters.results[0] ?? 'all')}
            onChange={(e) => {
              const value = e.target.value;
              set({ results: value === 'all' ? 'all' : ([value] as readonly GameResult[]) });
            }}
          >
            <option value="all">Any</option>
            {(['1-0', '0-1', '1/2-1/2'] as const).map((r) => (
              <option key={r} value={r}>
                {RESULT_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Opponent</span>
          <input
            data-testid="gfilter-opponent"
            value={filters.opponent}
            onChange={(e) => set({ opponent: e.target.value })}
            placeholder="Search opponent…"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>From</span>
          <input
            type="date"
            data-testid="gfilter-date-from"
            value={filters.dateFrom ?? ''}
            onChange={(e) => set({ dateFrom: e.target.value === '' ? null : e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>To</span>
          <input
            type="date"
            data-testid="gfilter-date-to"
            value={filters.dateTo ?? ''}
            onChange={(e) => set({ dateTo: e.target.value === '' ? null : e.target.value })}
          />
        </label>
      </div>

      <div className={styles.footer}>
        <span className={styles.count} data-testid="gfilter-count">
          {matched} of {total} games
        </span>
        <Button
          variant="ghost"
          data-testid="gfilter-reset"
          onClick={reset}
          disabled={filtersEqualDefaults(filters)}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

function isActive<T extends string>(option: MultiOption<T>, value: T): boolean {
  return option === 'all' ? value === 'all' : (option as readonly T[]).includes(value);
}

function filtersEqualDefaults(filters: GameListFilters): boolean {
  return (
    filters.sources === DEFAULT_GAME_LIST_FILTERS.sources &&
    filters.timeControls === DEFAULT_GAME_LIST_FILTERS.timeControls &&
    filters.colors === DEFAULT_GAME_LIST_FILTERS.colors &&
    filters.results === DEFAULT_GAME_LIST_FILTERS.results &&
    filters.opponent === '' &&
    filters.dateFrom === null &&
    filters.dateTo === null
  );
}
