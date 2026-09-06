import type * as React from 'react';
import { memo, useCallback } from 'react';
import type { MoveAnalysis } from '@/domain/chess';
import { cpValueOf, winPercentFromCp } from '@/domain/chess/classification';
import { formatEvaluation } from '@/components/analysis/engineFormat';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import styles from './EvaluationDiagram.module.css';

/**
 * Full-game evaluation diagram (Feature 008 Review polish, Q4).
 *
 * Renders the progress of the game as a **two-tone area chart**: one data
 * point per analyzed ply of the mainline, plotting White's winning-chance
 * percentage (0–100, re-expressed from each ply's stored eval-after) across
 * the game. The area below the line is White's, the area above it is Black's,
 * so the split between the two regions rises and falls as each side's position
 * improves. A dashed 50% reference marks the equal game. Clicking a column (or
 * pressing it with a keyboard) seeks that ply via `onSeek(ply)`; hovering a
 * column shows the numbered move and its White-positive evaluation.
 *
 * The diagram is a board-column "footer": it renders at the board column width
 * (below the bottom clock bar) so the chart aligns under the moves of the side
 * panel. Pure presentational component; all math is in `evaluationDiagramPoints`
 * (unit-testable) which consumes persisted `MoveAnalysis` records aligned to
 * the mainline (record index == ply index).
 */

/** One plotted point / interactive column of the diagram. */
export interface EvaluationDiagramPoint {
  /** 0-based ply of the mainline this point/column belongs to. */
  readonly ply: number;
  /** White's winning-chance percentage at this ply (0–100). */
  readonly whitePercent: number;
  /** Screen-reader/hover label (numbered move + SAN + White-positive eval). */
  readonly label: string;
  /** True when this ply is the currently displayed mainline move. */
  readonly active: boolean;
}

/** `+0.4`-style White-positive text for a stored eval-after (mover view). */
function whiteEvalText(evaluation: MoveAnalysis['evalAfter'], mover: MoveAnalysis['side']): string {
  if (evaluation.cp === null && evaluation.mate === null) {
    return '';
  }
  const asWhite: EngineEvaluation =
    evaluation.mate !== null
      ? { mate: mover === 'black' ? -evaluation.mate : evaluation.mate }
      : { cp: mover === 'black' ? -evaluation.cp! : evaluation.cp! };
  return formatEvaluation(asWhite);
}

/**
 * Map persisted mainline records to diagram points. Each point is the White
 * winning-chance percentage (0–100) of the position after that ply: the mover's
 * stored eval-after is re-expressed to White's side (complement for a Black
 * mover). Records that carry no usable evaluation plot a neutral 50%.
 * `activePly` is the 0-based mainline ply currently shown (`null` at the start
 * position or when exploring off the mainline).
 */
export function evaluationDiagramPoints(
  records: readonly MoveAnalysis[],
  activePly: number | null,
): readonly EvaluationDiagramPoint[] {
  const points: EvaluationDiagramPoint[] = [];
  records.forEach((record, ply) => {
    const moverWin =
      record.evalAfter.cp === null && record.evalAfter.mate === null
        ? 50
        : winPercentFromCp(cpValueOf(record.evalAfter));
    const whiteView = record.side === 'white' ? moverWin : 100 - moverWin;
    const whitePercent = Math.round(whiteView * 100) / 100;
    const moveNumber = `${record.moveNumber}${record.side === 'white' ? '' : '…'}`;
    const evalText = whiteEvalText(record.evalAfter, record.side);
    points.push({
      ply,
      whitePercent,
      label: `Move ${moveNumber} ${record.playedMove.san}${evalText ? `: ${evalText}` : ''}`,
      active: activePly === ply,
    });
  });
  return points;
}

/** The boundary line between White's and Black's regions (`x,y` pairs, x = i + 0.5). */
function boundaryCoordinates(points: readonly EvaluationDiagramPoint[]): string {
  return points.map((point, index) => `${index + 0.5},${100 - point.whitePercent}`).join(' ');
}

export interface EvaluationDiagramProps {
  /** Mainline-aligned persisted records; one point per record. */
  readonly records: readonly MoveAnalysis[];
  /** 0-based mainline ply currently shown (`null` = none/off-mainline). */
  readonly activePly: number | null;
  /** Seek to the given mainline ply (0-based index). */
  readonly onSeek: (ply: number) => void;
  readonly dataTestId?: string;
}

function EvaluationDiagramInner({
  records,
  activePly,
  onSeek,
  dataTestId = 'evaluation-diagram',
}: EvaluationDiagramProps): React.JSX.Element | null {
  const points = evaluationDiagramPoints(records, activePly);
  const seek = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const ply = Number(event.currentTarget.dataset.ply);
      if (Number.isInteger(ply)) {
        onSeek(ply);
      }
    },
    [onSeek],
  );

  if (points.length === 0) {
    return null;
  }

  const width = points.length;
  const single = points.length === 1;
  const boundary = single ? '' : boundaryCoordinates(points);
  // White's region is below the boundary (down to the bottom of the plot),
  // Black's region above it (up to the top).
  const whiteArea = single ? '' : `${boundary} ${width},100 0,100`;
  const blackArea = single
    ? ''
    : `${[...points]
        .reverse()
        .map((p, i) => `${width - 0.5 - i},${100 - p.whitePercent}`)
        .join(' ')} 0,0 ${width},0`;
  const whiteY = single ? 100 - points[0]!.whitePercent : 0;

  return (
    <div
      className={styles.diagram}
      data-testid={dataTestId}
      role="group"
      aria-label="Game evaluation area chart: White wins under the line, Black wins above it, across the moves. Each column is one move; click a column to jump to that move."
    >
      <svg
        className={styles.plot}
        viewBox={single ? '0 0 1 100' : `0 0 ${width} 100`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {single ? (
          <>
            <rect className={styles.areaBlack} x="0" y="0" width="1" height={whiteY} />
            <rect className={styles.areaWhite} x="0" y={whiteY} width="1" height={100 - whiteY} />
          </>
        ) : (
          <>
            <polygon className={styles.areaBlack} points={blackArea} />
            <polygon className={styles.areaWhite} points={whiteArea} />
          </>
        )}
        {/* The equal-game reference is drawn above both areas, and its stroke is
            a neutral mid-gray readable on White's light region and Black's dark
            region alike. */}
        <line className={styles.midline} x1="0" y1="50" x2={single ? 1 : width} y2="50" />
      </svg>
      <div className={styles.columns}>
        {points.map((point) => (
          <button
            type="button"
            key={point.ply}
            className={`${styles.column}${point.active ? ` ${styles.active}` : ''}`}
            data-testid={`${dataTestId}-segment-${point.ply}`}
            data-ply={point.ply}
            data-white-percent={point.whitePercent}
            aria-label={`${point.label}. Go to this move.`}
            title={point.label}
            onClick={seek}
          >
            <span className={styles.columnInner} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

export const EvaluationDiagram = memo(EvaluationDiagramInner);
