/**
 * Canonical classification presentation mapping (Feature 009).
 *
 * Single source of truth for how the five ADR-023 classification states
 * surface in the UI: the NAG glyph number (or none for ordinary moves),
 * a human label, a short explanation and whether the state is visually
 * emphasized. The data model is total (every `MoveAnalysis` carries one
 * of the five states); "unclassified" exists only in presentation and
 * means the ordinary `good` bucket, which renders with no glyph.
 *
 * Pure and framework-free — no React/DOM/DB imports. Classification math
 * stays in `src/domain/chess/classification.ts`; accuracy in
 * `src/domain/analysis/accuracy.ts`.
 */

import { MOVE_CLASSIFICATIONS } from '@/domain/chess';
import type { MoveClassification } from '@/domain/chess';

/** Canonical display/emphasis ordering of the five classification states. */
export const CLASSIFICATION_LABELS: readonly MoveClassification[] = [...MOVE_CLASSIFICATIONS];

/**
 * Classification → NAG number (ADR-023 glyph mapping). `null` means the
 * classification renders no glyph (`good` = ordinary, unemphasized).
 *
 * | Classification | NAG | Glyph |
 * |----------------|-----|-------|
 * | `best`         | 3   | `!!`  |
 * | `good`         | —   | none  |
 * | `inaccuracy`   | 6   | `?!`  |
 * | `mistake`      | 2   | `?`   |
 * | `blunder`      | 4   | `??`  |
 */
export const CLASSIFICATION_NAG: Readonly<Record<MoveClassification, number | null>> = {
  best: 3,
  good: null,
  inaccuracy: 6,
  mistake: 2,
  blunder: 4,
};

/** NAG number for a classification, or `null` when it renders no glyph. */
export function nagForClassification(classification: MoveClassification): number | null {
  return CLASSIFICATION_NAG[classification];
}

/**
 * True when the classification warrants visual emphasis (glyph/highlight).
 * Only ordinary `good` moves are unemphasized.
 */
export function isEmphasized(classification: MoveClassification): boolean {
  return classification !== 'good';
}

/** Canonical short label text for a classification (summary rows, aria). */
export const CLASSIFICATION_LABEL_TEXT: Readonly<Record<MoveClassification, string>> = {
  best: 'Best move',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

/** Canonical short explanation for a classification (title/aria/tooltip). */
export const CLASSIFICATION_EXPLANATION: Readonly<Record<MoveClassification, string>> = {
  best: "Matches the engine's best move.",
  good: 'A solid move with no significant loss.',
  inaccuracy: 'Lets a meaningful part of the advantage slip.',
  mistake: 'A significant error that worsens the position.',
  blunder: 'A decisive error that badly damages the position.',
};
