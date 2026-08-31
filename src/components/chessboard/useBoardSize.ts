import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOARD_SIZE_DEFAULT,
  BOARD_SIZE_KEY,
  MOBILE_BREAKPOINT_PX,
  clampBoardSize,
  snapBoardSize,
} from './boardSize';

export interface UseBoardSize {
  /** Persisted board size in pixels, always within `[240, 1024]`. */
  size: number;
  /** Live drag size (during the gesture). When not dragging, equals `size`. */
  dragSize: number | null;
  /** True while the user is mid-drag. */
  isDragging: boolean;
  /** True when the viewport is mobile (`<= 768 px`). */
  isMobile: boolean;
  /** Begin a drag. Captures the committed size for cancel-restore. */
  beginDrag: () => void;
  /** Update the live drag size (RAF-throttled by the caller). */
  updateDrag: (size: number) => void;
  /** Commit the current drag size to `localStorage`. */
  endDrag: () => void;
  /** Cancel the drag and restore the prior size. No persistence. */
  cancelDrag: () => void;
  /** Explicitly set the persisted size (used by the "Reset size" button). */
  setSize: (size: number) => void;
}

function readInitialSize(): number {
  if (typeof window === 'undefined') {
    return BOARD_SIZE_DEFAULT;
  }
  try {
    const stored = window.localStorage.getItem(BOARD_SIZE_KEY);
    if (stored === null) {
      return BOARD_SIZE_DEFAULT;
    }
    const parsed = Number.parseInt(stored, 10);
    if (!Number.isFinite(parsed)) {
      return BOARD_SIZE_DEFAULT;
    }
    return clampBoardSize(parsed);
  } catch {
    return BOARD_SIZE_DEFAULT;
  }
}

function writeSize(size: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(BOARD_SIZE_KEY, String(clampBoardSize(size)));
  } catch {
    /* localStorage may throw in incognito / private mode */
  }
}

function detectMobile(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

export function useBoardSize(): UseBoardSize {
  const [size, setSizeState] = useState<number>(() => readInitialSize());
  const [dragSize, setDragSize] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(() => detectMobile());

  // Listen for matchMedia changes so resize-aware consumers re-render
  // when the viewport crosses the mobile breakpoint.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const handler = (event: MediaQueryListEvent): void => {
      setIsMobile(event.matches);
    };
    mql.addEventListener('change', handler);
    return () => {
      mql.removeEventListener('change', handler);
    };
  }, []);

  const beginDrag = useCallback(() => {
    setIsDragging(true);
    setDragSize(size);
  }, [size]);

  const updateDrag = useCallback((next: number) => {
    setDragSize(clampBoardSize(next));
  }, []);

  const endDrag = useCallback(() => {
    setIsDragging((wasDragging) => {
      if (!wasDragging) {
        return false;
      }
      return false;
    });
    setDragSize((current) => {
      if (current === null) {
        return null;
      }
      const snapped = snapBoardSize(current);
      setSizeState(snapped);
      writeSize(snapped);
      return null;
    });
  }, []);

  const cancelDrag = useCallback(() => {
    setIsDragging(false);
    setDragSize(null);
  }, []);

  const setSize = useCallback((next: number) => {
    const clamped = clampBoardSize(next);
    setSizeState(clamped);
    writeSize(clamped);
  }, []);

  const visibleSize = useMemo(() => {
    return isDragging && dragSize !== null ? dragSize : size;
  }, [isDragging, dragSize, size]);

  return {
    size: visibleSize,
    dragSize,
    isDragging,
    isMobile,
    beginDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    setSize,
  };
}
