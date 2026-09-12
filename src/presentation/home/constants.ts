/**
 * Feature 018 — Home presentation constants (pure, no React).
 *
 * The bounded recent window every Home game-analysis read uses and the label
 * the cards show for it. `last3m` is the plan's recommended default so the
 * entry page never scans all history; the window is never silently widened.
 */

import type { TimeFrame } from '@/domain/gameLibrary/timeframe';

/** The bounded recent window Home queries and labels. */
export const HOME_STATS_WINDOW: TimeFrame = { preset: 'last3m' };

/** Human label of `HOME_STATS_WINDOW`, shown on every game-analysis card. */
export const HOME_STATS_WINDOW_LABEL = 'Last 3 months';
