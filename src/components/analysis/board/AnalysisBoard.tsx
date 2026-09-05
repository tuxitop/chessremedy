import type * as React from 'react';
import type { UseBoardSize } from '@/components/chessboard/useBoardSize';
import styles from './AnalysisBoard.module.css';

/**
 * Shared analysis-board surface (ADR-033). Both Game Review (Feature 008,
 * stored/live modes) and Live Analysis (Feature 006) render the same
 * three-column region through this component: the board column, the
 * evaluation-bar column (sized to the board) and the side panel.
 *
 * The component is mode-agnostic presentational chrome: each mode supplies
 * its own board/eval-bar/side-panel content and controls the shared
 * board-size, so the surface, its responsive behaviour and its sizing are
 * defined once. The evaluation bar column is only rendered when `bar` is
 * given; on mobile the layout stacks with the bar as a horizontal strip.
 */
export interface AnalysisBoardProps {
  readonly boardSize: UseBoardSize;
  /** Board column contents (the Chessboard plus anything under it). */
  readonly boardColumn: React.ReactNode;
  /** Evaluation-bar contents, or `null` to omit the column. */
  readonly bar: React.ReactNode;
  /** Side-panel contents. */
  readonly sidePanel: React.ReactNode;
  /** Optional inline style for the side panel (e.g. fixed board height). */
  readonly sidePanelStyle?: React.CSSProperties;
  /** Give the side panel the bordered "surface" chrome (Live Analysis). */
  readonly surface?: boolean;
  readonly dataTestId?: string;
}

export function AnalysisBoard({
  boardSize,
  boardColumn,
  bar,
  sidePanel,
  sidePanelStyle,
  surface = false,
  dataTestId,
}: AnalysisBoardProps): React.JSX.Element {
  return (
    <div className={styles.layout} data-testid={dataTestId}>
      <div className={styles.boardColumn}>{boardColumn}</div>
      {bar !== null ? (
        <div
          className={styles.evalBarColumn}
          style={!boardSize.isMobile ? { height: boardSize.size } : undefined}
        >
          {bar}
        </div>
      ) : null}
      <aside
        className={`${styles.sidePanel}${surface ? ` ${styles.surface}` : ''}`}
        style={sidePanelStyle}
      >
        {sidePanel}
      </aside>
    </div>
  );
}
