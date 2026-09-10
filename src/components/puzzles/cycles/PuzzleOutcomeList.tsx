import type * as React from 'react';
import type { CycleResolution } from '@/domain/training';
import { formatDurationMs } from './labels';
import styles from './PuzzleOutcomeList.module.css';

export interface PuzzleOutcomeListProps {
  /** One resolution per snapshot puzzle, in snapshot order. */
  readonly resolutions: readonly CycleResolution[];
  /**
   * Human-readable label per canonical puzzle id (e.g. the tactical
   * objective). Falls back to the raw id when omitted or unknown.
   */
  readonly labelFor?: (puzzleId: string) => string;
  readonly testId?: string;
}

/**
 * The textual per-puzzle outcome of a cycle: result, retries, wrong moves,
 * hints and solving time. Every value is spelled out; status is never
 * colour-only.
 */
export function PuzzleOutcomeList({
  resolutions,
  labelFor,
  testId = 'puzzle-outcomes',
}: PuzzleOutcomeListProps): React.JSX.Element {
  if (resolutions.length === 0) {
    return (
      <p className={styles.empty} data-testid={`${testId}-empty`}>
        No puzzles in this cycle.
      </p>
    );
  }

  return (
    <ol className={styles.list} data-testid={testId}>
      {resolutions.map((resolution, index) => {
        const position = index + 1;
        const detail = detailOf(resolution);
        return (
          <li
            key={resolution.puzzleId}
            className={styles.item}
            data-testid={`${testId}-item-${position}`}
          >
            <div className={styles.head}>
              <span className={styles.label} data-testid={`${testId}-label-${position}`}>
                {labelFor?.(resolution.puzzleId) ?? resolution.puzzleId}
              </span>
              <span className={styles.result} data-testid={`${testId}-result-${position}`}>
                {puzzleOutcomeLabel(resolution)}
              </span>
            </div>
            {detail !== '' ? (
              <p className={styles.detail} data-testid={`${testId}-detail-${position}`}>
                {detail}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Textual outcome of one puzzle's cycle resolution. */
export function puzzleOutcomeLabel(resolution: CycleResolution): string {
  if (resolution.presentationCount === 0) {
    return 'Not attempted';
  }
  if (resolution.skipped) {
    return 'Skipped';
  }
  if (resolution.firstTrySolved) {
    return 'Solved first try';
  }
  if (resolution.eventuallySolved) {
    return resolution.presentations.some((row) => row.result === 'solvedWithHelp')
      ? 'Solved with hints'
      : 'Solved on retry';
  }
  return 'Failed';
}

/** The per-puzzle detail line: retries, wrong moves, hints, solving time. */
function detailOf(resolution: CycleResolution): string {
  const parts: string[] = [];
  const retries = resolution.presentations.filter((row) => row.presentationIndex > 1).length;
  if (retries > 0) {
    parts.push(`${retries} ${retries === 1 ? 'retry' : 'retries'}`);
  }
  if (resolution.wrongMoves > 0) {
    parts.push(`${resolution.wrongMoves} wrong ${resolution.wrongMoves === 1 ? 'move' : 'moves'}`);
  }
  if (resolution.hints > 0) {
    parts.push(`${resolution.hints} ${resolution.hints === 1 ? 'hint' : 'hints'}`);
  }
  if (resolution.definite) {
    parts.push(`${formatDurationMs(resolution.solvingTimeMs)} solving time`);
  }
  return parts.join(' · ');
}
