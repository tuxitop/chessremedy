import type * as React from 'react';
import type { CycleConfig, HintLevel, OrderingPolicy, RetryFailed } from '@/domain/training';
import styles from './CycleConfigForm.module.css';

export const HINT_LEVELS: readonly HintLevel[] = [1, 2, 3, 4];

const ORDERING_OPTIONS: readonly { readonly value: OrderingPolicy; readonly label: string }[] = [
  { value: 'difficultyAsc', label: 'Difficulty (easiest first)' },
  { value: 'sourcePly', label: 'Game and move order' },
  { value: 'manual', label: 'Manual selection order' },
];

const RETRY_OPTIONS: readonly { readonly value: RetryFailed; readonly label: string }[] = [
  { value: 'endOfCycle', label: 'Retry failed puzzles at the end of the cycle' },
  { value: 'immediate', label: 'Retry a failed puzzle immediately' },
  { value: 'none', label: 'No retries' },
];

export interface CycleConfigFormProps {
  /** The config being edited; controlled. */
  readonly config: CycleConfig;
  readonly onChange: (config: CycleConfig) => void;
  /** Prefix for control test ids (e.g. `set-editor`). */
  readonly idPrefix: string;
}

/**
 * The reusable cycle-config editor (ordering, retry behaviour, hints, skip,
 * informational targets) plus a read-only "effective config" snapshot of the
 * exact values a new cycle would capture. Every control is a labelled native
 * input, keyboard/touch operable.
 */
export function CycleConfigForm({
  config,
  onChange,
  idPrefix,
}: CycleConfigFormProps): React.JSX.Element {
  const patch = (partial: Partial<CycleConfig>): void => onChange({ ...config, ...partial });

  const setOrdering = (ordering: OrderingPolicy): void => patch({ ordering });
  const setRetry = (retryFailed: RetryFailed): void => patch({ retryFailed });

  const toggleLevel = (level: HintLevel, enabled: boolean): void => {
    const current = new Set(config.hints.enabledLevels);
    if (enabled) {
      current.add(level);
    } else {
      if (current.size <= 1) {
        return;
      }
      current.delete(level);
    }
    const enabledLevels = HINT_LEVELS.filter((candidate) => current.has(candidate));
    const firstHintLevel = enabledLevels.includes(config.hints.firstHintLevel)
      ? config.hints.firstHintLevel
      : enabledLevels[0]!;
    patch({ hints: { enabledLevels, firstHintLevel } });
  };

  const summary = cycleConfigSummary(config);

  return (
    <div className={styles.form}>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>Ordering</span>
          <select
            value={config.ordering}
            onChange={(event) => setOrdering(event.target.value as OrderingPolicy)}
            data-testid={`${idPrefix}-ordering`}
          >
            {ORDERING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Retry failed puzzles</span>
          <select
            value={config.retryFailed}
            onChange={(event) => setRetry(event.target.value as RetryFailed)}
            data-testid={`${idPrefix}-retry`}
          >
            {RETRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>First hint level</span>
          <select
            value={config.hints.firstHintLevel}
            onChange={(event) =>
              patch({
                hints: { ...config.hints, firstHintLevel: Number(event.target.value) as HintLevel },
              })
            }
            data-testid={`${idPrefix}-first-hint`}
          >
            {HINT_LEVELS.map((level) => (
              <option key={level} value={level}>
                Level {level}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Target accuracy (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={config.targetAccuracy === null ? '' : Math.round(config.targetAccuracy * 100)}
            placeholder="Not set"
            onChange={(event) =>
              patch({
                targetAccuracy:
                  event.target.value.trim() === '' ? null : Number(event.target.value) / 100,
              })
            }
            data-testid={`${idPrefix}-target-accuracy`}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Target solving time (seconds)</span>
          <input
            type="number"
            min={0}
            value={
              config.targetSolvingTimeMs === null
                ? ''
                : Math.round(config.targetSolvingTimeMs / 1000)
            }
            placeholder="Not set"
            onChange={(event) =>
              patch({
                targetSolvingTimeMs:
                  event.target.value.trim() === '' ? null : Number(event.target.value) * 1000,
              })
            }
            data-testid={`${idPrefix}-target-time`}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Planned cycles</span>
          <input
            type="number"
            min={1}
            value={config.plannedCycles ?? ''}
            placeholder="Not set"
            onChange={(event) =>
              patch({
                plannedCycles: event.target.value.trim() === '' ? null : Number(event.target.value),
              })
            }
            data-testid={`${idPrefix}-planned-cycles`}
          />
        </label>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Hint levels available</legend>
        <div className={styles.checks}>
          {HINT_LEVELS.map((level) => (
            <label key={level} className={styles.check}>
              <input
                type="checkbox"
                checked={config.hints.enabledLevels.includes(level)}
                onChange={(event) => toggleLevel(level, event.target.checked)}
                data-testid={`${idPrefix}-hint-level-${level}`}
              />
              <span>Level {level}</span>
            </label>
          ))}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={config.allowSkip}
              onChange={(event) => patch({ allowSkip: event.target.checked })}
              data-testid={`${idPrefix}-allow-skip`}
            />
            <span>Allow skipping puzzles</span>
          </label>
        </div>
      </fieldset>

      <section className={styles.snapshot} aria-labelledby={`${idPrefix}-snapshot-title`}>
        <h3 className={styles.snapshotTitle} id={`${idPrefix}-snapshot-title`}>
          Effective config
        </h3>
        <p className={styles.snapshotHint}>
          A new cycle captures these values as an immutable snapshot.
        </p>
        <dl className={styles.snapshotList} data-testid={`${idPrefix}-config-snapshot`}>
          {summary.map((entry) => (
            <div key={entry.label} className={styles.snapshotRow}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

const ORDERING_LABELS: Readonly<Record<OrderingPolicy, string>> = {
  difficultyAsc: 'Difficulty (easiest first)',
  sourcePly: 'Game and move order',
  manual: 'Manual selection order',
};

const RETRY_LABELS: Readonly<Record<RetryFailed, string>> = {
  endOfCycle: 'Failed puzzles retried at the end of the cycle',
  immediate: 'Failed puzzles retried immediately',
  none: 'No retries',
};

/** The read-only effective-config facts, in a fixed order (deterministic). */
export function cycleConfigSummary(
  config: CycleConfig,
): readonly { readonly label: string; readonly value: string }[] {
  const levels = HINT_LEVELS.filter((level) => config.hints.enabledLevels.includes(level));
  return [
    { label: 'Ordering', value: ORDERING_LABELS[config.ordering] },
    { label: 'Retries', value: RETRY_LABELS[config.retryFailed] },
    {
      label: 'Hints',
      value:
        levels.length === 0
          ? 'Disabled'
          : `Levels ${levels.join(', ')} · first press level ${config.hints.firstHintLevel}`,
    },
    { label: 'Skipping', value: config.allowSkip ? 'Allowed' : 'Not allowed' },
    {
      label: 'Target accuracy',
      value:
        config.targetAccuracy === null ? 'Not set' : `${Math.round(config.targetAccuracy * 100)}%`,
    },
    {
      label: 'Target solving time',
      value:
        config.targetSolvingTimeMs === null
          ? 'Not set'
          : `${Math.round(config.targetSolvingTimeMs / 1000)}s`,
    },
    {
      label: 'Planned cycles',
      value: config.plannedCycles === null ? 'Not set' : String(config.plannedCycles),
    },
  ];
}
