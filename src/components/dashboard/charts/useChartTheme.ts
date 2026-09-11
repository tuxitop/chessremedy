import { useEffect, useMemo, useState } from 'react';
import {
  CLASSIFICATION_COLORS,
  MISSED_TACTIC_COLOR,
} from '@/components/analysis/classificationColors';

/** The four error classes shared by the game-phase chart and error trends. */
export type ChartErrorClass = 'inaccuracies' | 'mistakes' | 'blunders' | 'missedTactics';

/** Resolved chart styling. Axis/grid/text/tooltip values are theme tokens. */
export interface ChartTheme {
  readonly theme: 'light' | 'dark';
  readonly axis: string;
  readonly grid: string;
  readonly text: string;
  readonly tooltipBg: string;
  readonly tooltipBorder: string;
  /** Distinct series colours for concrete partitions (theme tokens). */
  readonly series: readonly string[];
  /** Canonical Feature-009 error-class colours (text labels accompany them). */
  readonly error: Readonly<Record<ChartErrorClass, string>>;
}

const TOKEN_STYLES = {
  axis: 'var(--color-fg-muted)',
  grid: 'var(--color-border)',
  text: 'var(--color-fg)',
  tooltipBg: 'var(--color-surface)',
  tooltipBorder: 'var(--color-border)',
  series: [
    'var(--color-accent)',
    'var(--color-success)',
    'var(--color-warning)',
    'var(--color-danger)',
    'var(--color-fg-muted)',
    'var(--color-border-strong)',
  ],
} as const;

const ERROR_COLORS: Readonly<Record<ChartErrorClass, string>> = {
  inaccuracies: CLASSIFICATION_COLORS.inaccuracy,
  mistakes: CLASSIFICATION_COLORS.mistake,
  blunders: CLASSIFICATION_COLORS.blunder,
  missedTactics: MISSED_TACTIC_COLOR,
};

function readThemeName(): 'light' | 'dark' {
  if (typeof document === 'undefined') {
    return 'light';
  }
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Theme-token styling for Recharts. Values are CSS custom properties, so the
 * same props render legibly in light and dark without fixed colours. The hook
 * observes the `data-theme` attribute so the returned object updates with the
 * theme.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readThemeName());

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    const observer = new MutationObserver(() => setTheme(readThemeName()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return useMemo(
    () => ({
      theme,
      ...TOKEN_STYLES,
      error: ERROR_COLORS,
    }),
    [theme],
  );
}
