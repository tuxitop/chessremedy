import type * as React from 'react';
import { ALL_PARTITIONS_LABEL, type PartitionOption } from '@/presentation/dashboard';
import styles from './PartitionSelector.module.css';

export interface PartitionSelectorProps {
  readonly options: readonly PartitionOption[];
  /** Selected option value (`all` or a concrete `platform:timeControl` key). */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
  readonly testId?: string;
}

/**
 * Single-select partition control. The explicit "All partitions" choice is
 * always listed first; concrete partitions are shown separately so rapid and
 * blitz are never silently merged.
 */
export function PartitionSelector({
  options,
  value,
  onChange,
  label = 'Partition',
  testId = 'partition-selector',
}: PartitionSelectorProps): React.JSX.Element {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">{ALL_PARTITIONS_LABEL}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
