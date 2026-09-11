import type * as React from 'react';
import type { TacticalTrainingSetRow } from '@/domain/training';
import { selectDefaultTrainingSet } from '@/presentation/dashboard';
import styles from './TrainingSetSelector.module.css';

export interface TrainingSetSelectorProps {
  /** Active custom sets (the open block is passed separately). */
  readonly sets: readonly TacticalTrainingSetRow[];
  /** Archived sets, grouped behind their own labelled affordance. */
  readonly archivedSets: readonly TacticalTrainingSetRow[];
  /** The open Woodpecker block, listed first when present. */
  readonly openBlock: TacticalTrainingSetRow | null;
  /** The selected set id, or `null` when nothing is selected yet. */
  readonly value: string | null;
  onSelect(setId: string | null): void;
  readonly testId?: string;
}

/**
 * Set-scoped training-set selector. The open Woodpecker block is listed first,
 * then active custom sets, then archived sets in a separate `optgroup` so they
 * are grouped behind a labelled affordance. Selection is owned by the caller
 * (the `useDashboard` hook persists it in the `set` URL param). No game filter
 * is applied here.
 */
export function TrainingSetSelector({
  sets,
  archivedSets,
  openBlock,
  value,
  onSelect,
  testId = 'training-set-selector',
}: TrainingSetSelectorProps): React.JSX.Element {
  const activeSets = sets.filter((set) => set.id !== openBlock?.id);
  const optionIds = [
    ...(openBlock === null ? [] : [openBlock.id]),
    ...activeSets.map((set) => set.id),
    ...archivedSets.map((set) => set.id),
  ];
  // The hook resolves the default via `selectDefaultTrainingSet`; this is a
  // defensive fallback for a brief pre-selection render (A5: open block, else
  // the most recently active set).
  const fallback = selectDefaultTrainingSet(activeSets, archivedSets, openBlock ?? undefined);
  const selected = value !== null && optionIds.includes(value) ? value : (fallback?.id ?? '');

  return (
    <label className={styles.field}>
      <span className={styles.label}>Training set</span>
      <select
        className={styles.select}
        data-testid={testId}
        value={selected}
        onChange={(event) => onSelect(event.target.value === '' ? null : event.target.value)}
      >
        {openBlock !== null ? (
          <option value={openBlock.id}>{openBlock.name} (open block)</option>
        ) : null}
        {activeSets.length > 0 ? (
          <optgroup label="Active sets">
            {activeSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {archivedSets.length > 0 ? (
          <optgroup label="Archived sets">
            {archivedSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
