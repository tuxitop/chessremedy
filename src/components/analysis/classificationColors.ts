/**
 * Canonical classification display colors (Feature 009 polish, P5/P4).
 *
 * Single source of truth for how each ADR-023 classification state is tinted
 * in the UI (Library insight counts, Review Summary values, square
 * highlights). The palette matches `pgnAnnotations.ts` NAG glyph colors and
 * `reviewBoardHighlights.css` tints — this module is the shared mapping so
 * counts, glyphs and highlights never drift apart.
 *
 * Colour never carries information alone: every coloured value keeps its
 * visible glyph/label and an accessible description. Pure and framework-free.
 */

import type { MoveClassification } from '@/domain/chess';

/** CSS token-independent colour per classification (hex). */
export const CLASSIFICATION_COLORS: Readonly<Record<MoveClassification, string>> = {
  best: '#15781b',
  good: '#15781b',
  inaccuracy: '#d89000',
  mistake: '#d94f00',
  blunder: '#c4261c',
};

/** Missed-tactic marker colour (canonical magenta, mirrors NAG_META[9]). */
export const MISSED_TACTIC_COLOR = '#c2185b';

/**
 * The Library/Summary "zero" colour for the negative classes: a zero count is
 * shown green (nothing went wrong) unless the classification colour applies.
 */
export const ZERO_COUNT_COLOR = '#15781b';

/** Neutral presentation colour (no emphasis) for zero best/good counts. */
export const NEUTRAL_COUNT_COLOR = 'var(--color-fg-muted, #6b7280)';

/**
 * Colour for one classification's count value (Library strip / Summary).
 * Zero-rule (Q5): the negative classes read green when nothing went wrong;
 * `best`/`good` are never emphasised when zero (neutral).
 */
export function classificationCountColor(
  classification: MoveClassification,
  count: number,
): string {
  if (count > 0) {
    return CLASSIFICATION_COLORS[classification];
  }
  if (classification === 'best') {
    return NEUTRAL_COUNT_COLOR;
  }
  if (classification === 'good') {
    return NEUTRAL_COUNT_COLOR;
  }
  return ZERO_COUNT_COLOR;
}

/** Missed-tactic count colour: green when zero, else the marker magenta. */
export function missedTacticCountColor(count: number): string {
  return count > 0 ? MISSED_TACTIC_COLOR : ZERO_COUNT_COLOR;
}
