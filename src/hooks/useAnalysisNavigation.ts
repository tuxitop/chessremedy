import { useEffect } from 'react';

export interface AnalysisNavigationHandlers {
  onFirst(): void;
  onPrev(): void;
  onNext(): void;
  onLast(): void;
}

/**
 * Keyboard navigation for stepping through game moves (arrow keys).
 * `←`/`→` step back/forward one ply; `Shift+←`/`Shift+→` jump to first/last.
 * Keydown is ignored while the user is typing in an input/textarea/select or
 * editing content. Buttons always remain, so the keyboard is never the only
 * way to perform an action (ADR-033).
 */
export function useAnalysisNavigation(handlers: AnalysisNavigationHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        const interactive = target.closest('input, textarea, select, [contenteditable="true"]');
        if (interactive) {
          return;
        }
      }
      const shifted = event.shiftKey;
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          if (shifted) {
            handlers.onFirst();
          } else {
            handlers.onPrev();
          }
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (shifted) {
            handlers.onLast();
          } else {
            handlers.onNext();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, handlers]);
}
