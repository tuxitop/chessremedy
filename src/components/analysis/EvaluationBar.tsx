import type { EngineEvaluation } from '@/infrastructure/engine/types';
import type { PlayerColor } from './evaluation';
import { bottomAdvantageFraction } from './evaluation';
import styles from './EvaluationBar.module.css';

export interface EvaluationBarProps {
  /** Best evaluation of the current position (side-to-move perspective). */
  readonly evaluation: EngineEvaluation | null;
  /** Colour of the player at the bottom of the board. */
  readonly bottomColor: PlayerColor;
  /** Side to move in the current position. */
  readonly sideToMove: PlayerColor;
}

/**
 * Vertical evaluation gauge shown between the board and the move list.
 * Fills from the bottom toward the top with the bottom player's advantage;
 * the fixed centre line marks the equal position.
 */
export function EvaluationBar({
  evaluation,
  bottomColor,
  sideToMove,
}: EvaluationBarProps): React.JSX.Element {
  const fill =
    evaluation === null ? null : bottomAdvantageFraction(evaluation, bottomColor, sideToMove);
  const fillHeight = fill === null ? null : `${Math.round(fill * 100)}%`;

  return (
    <div
      className={styles.bar}
      data-testid="evaluation-bar"
      role="img"
      aria-label={
        evaluation === null
          ? 'No engine evaluation'
          : `Evaluation: ${fill === null ? '' : Math.round((fill ?? 0.5) * 100)} percent for the player at the bottom`
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
