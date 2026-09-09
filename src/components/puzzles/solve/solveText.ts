import { uciPvToSan } from '@/domain/chess';
import type { TrainingResult } from '@/domain/training';

/** Human label for a presentation outcome result (outcome panels/aria). */
export const RESULT_LABELS: Readonly<Record<TrainingResult, string>> = {
  solvedFirstTry: 'Solved on the first try',
  solvedWithHelp: 'Solved with help',
  failed: 'Gave up',
  skipped: 'Skipped',
};

/** Human label for a `TrainingResult`. */
export function resultLabel(result: TrainingResult): string {
  return RESULT_LABELS[result];
}

/** `65000` → `1:05`; wall-clock solving time display. */
export function formatSolveTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Render UCI move tokens as a SAN string from a FEN, falling back to the raw
 * UCI tokens when the line does not replay (a truthful, never-fabricated
 * fallback — e.g. a wrong move tried at a later decision point).
 */
export function displayMoveText(fen: string, tokens: readonly string[]): string {
  if (tokens.length === 0) {
    return '';
  }
  const converted = uciPvToSan(fen, [...tokens]);
  return converted.ok ? converted.sans.join(' ') : tokens.join(' ');
}
