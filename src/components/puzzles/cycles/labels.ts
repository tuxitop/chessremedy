import type { TrainingCycleStatus, TrainingSetStatus } from '@/domain/training';

/** Textual status labels — status is never conveyed by colour alone. */
export const CYCLE_STATUS_LABELS: Readonly<Record<TrainingCycleStatus, string>> = {
  inProgress: 'In progress',
  completed: 'Completed',
  abandoned: 'Abandoned',
};

export const SET_STATUS_LABELS: Readonly<Record<TrainingSetStatus, string>> = {
  active: 'Active',
  archived: 'Archived',
};

export function cycleStatusLabel(status: TrainingCycleStatus): string {
  return CYCLE_STATUS_LABELS[status];
}

/** Local-time display of an epoch-millis timestamp; `null` stays `null`. */
export function formatTimestamp(ms: number | null): string | null {
  if (ms === null) {
    return null;
  }
  return new Date(ms).toLocaleString();
}

/** `65000` → `1:05`; compact solving-time display (matches the solve clock). */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** `0.6667` → `67%`; `null` stays `null` (an empty sample, never `0`). */
export function formatPercent(value: number | null): string | null {
  return value === null ? null : `${Math.round(value * 100)}%`;
}
