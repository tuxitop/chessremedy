import { useEffect, useRef, useState, type RefObject } from 'react';

/** Extra reveal threshold (px) used on coarse-pointer/touch viewports. */
const MOBILE_EXTRA_THRESHOLD = 24;

export interface UseHeaderVisibilityOptions {
  /**
   * Keep the header visible while a header surface (menu, popover, dialog) is
   * open, regardless of scroll direction.
   */
  forceVisible?: boolean;
}

export interface UseHeaderVisibilityResult {
  /** True when the header is translated out of view. */
  hidden: boolean;
  /** Attach to the header element so its height can be measured. */
  headerRef: RefObject<HTMLElement | null>;
}

/**
 * Feature 017 (W1) header visibility.
 *
 * The header hides on scroll-down and reveals on scroll-up, but stays visible
 * while `scrollY` is at or below its own height. A single passive scroll
 * listener throttled with `requestAnimationFrame` reads only `scrollY`; the
 * header height is measured on mount and on resize. Without a `window`
 * (tests/SSR) the hook is a no-op and the header stays visible.
 */
export function useHeaderVisibility({
  forceVisible = false,
}: UseHeaderVisibilityOptions = {}): UseHeaderVisibilityResult {
  const headerRef = useRef<HTMLElement | null>(null);
  const [internalHidden, setInternalHidden] = useState(false);
  const forceVisibleRef = useRef(forceVisible);

  useEffect(() => {
    forceVisibleRef.current = forceVisible;
  }, [forceVisible]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const header = headerRef.current;
    let headerHeight = header?.getBoundingClientRect().height ?? 0;
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const extraThreshold = coarsePointer ? MOBILE_EXTRA_THRESHOLD : 0;

    let lastScrollY = window.scrollY;
    let frame = 0;

    const measure = (): void => {
      headerHeight = header?.getBoundingClientRect().height ?? 0;
    };

    const update = (): void => {
      frame = 0;
      const scrollY = window.scrollY;
      if (forceVisibleRef.current || scrollY <= headerHeight + extraThreshold) {
        lastScrollY = scrollY;
        setInternalHidden(false);
        return;
      }
      const direction = scrollY > lastScrollY ? 'down' : 'up';
      lastScrollY = scrollY;
      setInternalHidden(direction === 'down');
    };

    const onScroll = (): void => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(update);
    };

    const onResize = (): void => {
      measure();
      update();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    let observer: ResizeObserver | undefined;
    if (header && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(header);
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      observer?.disconnect();
    };
  }, []);

  return { hidden: forceVisible ? false : internalHidden, headerRef };
}
