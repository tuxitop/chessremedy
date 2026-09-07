import { useEffect } from 'react';

/**
 * Warn before the tab is closed/reloaded while engine work (analysis jobs or
 * tactics scans) is live in this session. Engine work is resumable (WP-A), so
 * the browser's native confirmation lets the user either keep the work running
 * or leave it to be resumed later. SPA navigation does not unload the page —
 * the shared service keeps working across routes — so only `beforeunload` is
 * guarded here.
 */
export function useCloseInterruptGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return;
    }
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = message;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active, message]);
}
