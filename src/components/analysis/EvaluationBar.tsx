import type { EngineEvaluation } from '@/infrastructure/engine/types';
import type { PlayerColor } from './evaluation';
import { bottomAdvantageFraction } from './evaluation';
import styles from './EvaluationBar.module.css';

export interface EvaluationBarProps {
  /** Best evaluation of the current position (side-to-move perspective). */
  readonly evaluation: EngineEvaluation | null;
  /** Side to move in the current position. */
  readonly sideToMove: PlayerColor;
}

/**
 * Vertical evaluation gauge shown between the board and the move list. The
 * gauge always encodes **White's** advantage (White-positive, like every
 * numeric evaluation): it fills upward from the bottom with White's share, so
 * `+` (good for White) grows the fill and the fixed centre line marks the
 * equal position. It does not track the board orientation (D1 parity).
 */
export function EvaluationBar({ evaluation, sideToMove }: EvaluationBarProps): React.JSX.Element {
  const fill =
    evaluation === null ? null : bottomAdvantageFraction(evaluation, 'white', sideToMove);
  const fillHeight = fill === null ? null : `${Math.round(fill * 100)}%`;

  return (
    <div
      className={styles.bar}
      data-testid="evaluation-bar"
      role="img"
      aria-label={
        evaluation === null
          ? 'No engine evaluation'
          : `Evaluation: White ${fill === null ? '' : `${Math.round((fill ?? 0.5) * 100)} percent`}`
      }
    >
      <div
        className={styles.fill}
        data-testid="evaluation-bar-fill"
        style={fillHeight !== null ? { height: fillHeight } : undefined}
      />
      <div className={styles.centerMark} data-testid="evaluation-bar-center" />
    </div>
  );
}
