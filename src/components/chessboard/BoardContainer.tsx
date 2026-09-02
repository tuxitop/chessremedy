import type * as React from 'react';
import { useBoardSize, type UseBoardSize } from './useBoardSize';
import { MOBILE_BREAKPOINT_PX } from './boardSize';
import styles from './BoardContainer.module.css';

export interface BoardContainerProps {
  children: React.ReactNode;
  /** Optional content overlaid above the board (e.g. NAG/checkmate badges). */
  overlay?: React.ReactNode;
  /** Optional `aria-label` for the board region. */
  ariaLabel?: string;
  /** Shared board-size API. When omitted the container owns its own. */
  boardSize?: UseBoardSize;
}

/**
 * Wraps a Chessground host element with the resize primitive
 * (invisible bottom-right corner hit region) and layout containment.
 *
 * The hit region is intentionally invisible — only the cursor shape
 * changes to `nwse-resize` on hover. The wrapper sets `aspect-ratio: 1 / 1`
 * so it stays square at any chosen size.
 */
export function BoardContainer({
  children,
  overlay,
  ariaLabel,
  boardSize: sharedBoardSize,
}: BoardContainerProps): React.JSX.Element {
  const ownBoard = useBoardSize();
  const board = sharedBoardSize ?? ownBoard;

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (board.isMobile) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    board.beginDrag();

    const startY = event.clientY;
    const startX = event.clientX;
    const startSize = board.size;

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const delta = Math.max(moveEvent.clientY - startY, moveEvent.clientX - startX);
      board.updateDrag(startSize + delta);
    };

    const finish = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', handleEscape);
      try {
        handle.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* ignore */
      }
      board.endDrag();
    };

    const handleEscape = (escEvent: KeyboardEvent): void => {
      if (escEvent.key !== 'Escape') {
        return;
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', handleEscape);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      board.cancelDrag();
    };

    // Attach on window so Escape works even though the handle never
    // receives keyboard focus (it is aria-hidden / not focusable).
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', handleEscape);
  };

  return (
    <div
      className={`${styles.container} ${board.isMobile ? styles.mobile : ''}`}
      data-testid="board-container"
      data-dragging={board.isDragging ? 'true' : 'false'}
      data-board-size={board.size}
      aria-label={ariaLabel ?? 'Chessboard'}
      style={
        board.isMobile
          ? undefined
          : {
              width: board.size,
              height: board.size,
            }
      }
    >
      <div className={styles.host}>{children}</div>
      {overlay !== undefined && (
        <div className={styles.overlay} data-testid="board-overlay">
          {overlay}
        </div>
      )}
      {!board.isMobile && (
        <div
          className={styles.handle}
          role="presentation"
          aria-hidden="true"
          onPointerDown={handleResizePointerDown}
          data-testid="board-resize-handle"
        />
      )}
    </div>
  );
}

BoardContainer.MOBILE_BREAKPOINT_PX = MOBILE_BREAKPOINT_PX;
