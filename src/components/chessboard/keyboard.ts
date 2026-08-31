/**
 * Keyboard shortcut helpers for the PgnViewer API.
 *
 * The PgnViewer itself has `keyboardToMove` mode (arrow keys / Home /
 * End / Alt+Arrow for variations) but it is bound to the viewer's own
 * host element. This helper lets a caller bind the same shortcuts at
 * any other element (e.g., the global window) when the playground's
 * move list is out of focus.
 */

import type { PgnViewerApi, PgnViewerGoTo } from './PgnViewer';

export interface KeyboardNavOptions {
  api: PgnViewerApi | null;
  /** Called after a shortcut resolves. */
  onNavigate?: (to: PgnViewerGoTo) => void;
}

/**
 * Returns a `keydown` handler that delegates the standard PgnViewer
 * shortcuts (`ArrowLeft`, `ArrowRight`, `Home`, `End`) to the viewer.
 *
 * The handler is a no-op when `api` is null (i.e., the viewer is not
 * yet ready).
 */
export function createKeyboardNavHandler({
  api,
  onNavigate,
}: KeyboardNavOptions): (event: KeyboardEvent) => void {
  return (event) => {
    if (!api) {
      return;
    }
    let to: PgnViewerGoTo | null = null;
    if (event.key === 'ArrowLeft') {
      to = 'prev';
    } else if (event.key === 'ArrowRight') {
      to = 'next';
    } else if (event.key === 'Home') {
      to = 'first';
    } else if (event.key === 'End') {
      to = 'last';
    }
    if (to === null) {
      return;
    }
    event.preventDefault();
    api.goTo(to);
    onNavigate?.(to);
  };
}
