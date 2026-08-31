import type * as React from 'react';
import { useBoardSize } from './useBoardSize';
import { MOBILE_BREAKPOINT_PX } from './boardSize';
import styles from './BoardContainer.module.css';

export interface BoardContainerProps {
  children: React.ReactNode;
  /** Optional ref to the host element (so Chessground can mount into it). */
  hostRef?: React.RefObject<HTMLDivElement | null>;
  /** Optional `aria-label` for the board region. */
  ariaLabel?: string;
}

/**
 * Wraps a Chessground host element with the resize primitive
 * (corner drag handle) and layout containment.
 *
 * Children render into the chessboard region; the host `<div>` (the
 * first child the consumer puts into `hostRef`) sits inside this
 * wrapper.
 */
export function BoardContainer({ children, ariaLabel }: BoardContainerProps): React.JSX.Element {
  const board = useBoardSize();
  const handleResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (board.isMobile) {
      return;
    }
    event.preventDefault();
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    board.beginDrag();

    const startY = event.clientY;
    const startSize = board.size;

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientY - startY;
      const next = startSize + delta;
      board.updateDrag(next);
    };

    const handlePointerUp = (upEvent: PointerEvent): void => {
      button.removeEventListener('pointermove', handlePointerMove);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerUp);
      if (upEvent.pointerId !== event.pointerId) {
        button.releasePointerCapture(upEvent.pointerId);
      } else {
        try {
          button.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      }
      board.endDrag();
    };

    const handleEscape = (escEvent: KeyboardEvent): void => {
      if (escEvent.key !== 'Escape') {
        return;
      }
      button.removeEventListener('pointermove', handlePointerMove);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerUp);
      button.removeEventListener('keydown', handleEscape);
      try {
        button.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      board.cancelDrag();
    };

    button.addEventListener('pointermove', handlePointerMove);
    button.addEventListener('pointerup', handlePointerUp);
    button.addEventListener('pointercancel', handlePointerUp);
    button.addEventListener('keydown', handleEscape);
  };

  return (
    <div
      className={styles.container}
      data-testid="board-container"
      data-dragging={board.isDragging ? 'true' : 'false'}
      aria-label={ariaLabel ?? 'Chessboard'}
      style={{
        width: board.size,
        height: board.size,
      }}
    >
      <div className={styles.host}>{children}</div>
      {!board.isMobile && (
        <button
          type="button"
          className={styles.handle}
          aria-label="Resize board"
          aria-describedby="board-resize-hint"
          onPointerDown={handleResizePointerDown}
          data-testid="board-resize-handle"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3 13L13 3M3 13L8 13M3 13L3 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

BoardContainer.MOBILE_BREAKPOINT_PX = MOBILE_BREAKPOINT_PX;
