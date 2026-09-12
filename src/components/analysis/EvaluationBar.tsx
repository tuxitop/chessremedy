import type { EngineEvaluation } from '@/infrastructure/engine/types';
import type { PlayerColor } from './evaluation';
import { bottomAdvantageFraction } from './evaluation';
import styles from './EvaluationBar.module.css';

/** Orientation of the gauge. Mobile stacks use a horizontal strip. */
export type EvaluationBarOrientation = 'vertical' | 'horizontal';

export interface EvaluationBarProps {
  /** Best evaluation of the current position (side-to-move perspective). */
  readonly evaluation: EngineEvaluation | null;
  /** Side to move in the current position. */
  readonly sideToMove: PlayerColor;
  /**
   * `vertical` (default) sits in its own column beside the board; `horizontal`
   * is a strip under the board for the stacked mobile layout.
   */
  readonly orientation?: EvaluationBarOrientation;
}

/**
 * Evaluation gauge shown between the board and the move list. The gauge always
 * encodes **White's** advantage (White-positive, like every numeric
 * evaluation): the fill grows from the "White" end — bottom when vertical, left
 * when horizontal — so `+` (good for White) grows the fill and the fixed centre
 * line marks the equal position. It does not track board orientation (D1
 * parity).
 */
export function EvaluationBar({
  evaluation,
  sideToMove,
  orientation = 'vertical',
}: EvaluationBarProps): React.JSX.Element {
  const fill =
    evaluation === null ? null : bottomAdvantageFraction(evaluation, 'white', sideToMove);
  const fillPercent = fill === null ? null : `${Math.round(fill * 100)}%`;
  const horizontal = orientation === 'horizontal';

  return (
    <div
      className={[styles.bar, horizontal ? styles.barHorizontal : ''].filter(Boolean).join(' ')}
      data-testid="evaluation-bar"
      data-orientation={orientation}
      role="img"
      aria-label={
        evaluation === null
          ? 'No engine evaluation'
          : `Evaluation: White ${fill === null ? '' : `${Math.round((fill ?? 0.5) * 100)} percent`}`
      }
    >
      <div
        className={[styles.fill, horizontal ? styles.fillHorizontal : ''].filter(Boolean).join(' ')}
        data-testid="evaluation-bar-fill"
        style={
          fillPercent !== null
            ? horizontal
              ? { width: fillPercent }
              : { height: fillPercent }
            : undefined
        }
      />
      <div
        className={[styles.centerMark, horizontal ? styles.centerMarkHorizontal : '']
          .filter(Boolean)
          .join(' ')}
        data-testid="evaluation-bar-center"
      />
    </div>
  );
}
