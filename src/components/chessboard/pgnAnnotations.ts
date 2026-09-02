/**
 * PGN comment annotations (`%cal` arrows, `%csl` square highlights)
 * and NAG (Numeric Annotation Glyph) metadata for Feature 002.
 *
 * Lichess and Chess.com encode arrows / square highlights inside
 * `{ ... }` comments using the tags:
 *
 *   [%cal Ge2e4,Rd7d5]  → arrows (color letter + from-square + to-square)
 *   [%csl Gd4,Re5]      → square highlights (color letter + square)
 *
 * Color letters: G green, R red, B blue, Y yellow, O orange, P purple.
 *
 * NAGs are parsed by chessops into a numeric list per move. This module
 * maps the numbers the product cares about to a glyph and a color.
 * `$9` (used by Chess.com for a missed tactic) is not a standard PGN
 * NAG; ChessRemedy renders it as a distinct `X` glyph so move
 * classification (Feature 009) can reuse the marker later.
 */

export type AnnotationColorLetter = 'G' | 'R' | 'B' | 'Y' | 'O' | 'P';

export interface AnnotationShape {
  /** Chessground brush name used for the auto shape. */
  brush: string;
  /** CSS/text color matching the brush. */
  color: string;
}

export interface ArrowAnnotation {
  readonly kind: 'arrow';
  readonly from: string;
  readonly to: string;
  readonly color: AnnotationColor;
}

export interface SquareAnnotation {
  readonly kind: 'square';
  readonly square: string;
  readonly color: AnnotationColor;
}

export type Annotation = ArrowAnnotation | SquareAnnotation;

export interface AnnotationColor extends AnnotationShape {
  readonly letter: AnnotationColorLetter;
}

export const ANNOTATION_COLORS: Readonly<Record<AnnotationColorLetter, AnnotationColor>> = {
  G: { letter: 'G', brush: 'green', color: '#15781b' },
  R: { letter: 'R', brush: 'red', color: '#c33' },
  B: { letter: 'B', brush: 'blue', color: '#1a56db' },
  Y: { letter: 'Y', brush: 'yellow', color: '#d89000' },
  O: { letter: 'O', brush: 'orange', color: '#ec7d10' },
  P: { letter: 'P', brush: 'purple', color: '#7b2fbf' },
};

/** Extra brush definitions to register on the Chessground config. */
export const ANNOTATION_EXTRA_BRUSHES: Record<
  string,
  { key: string; color: string; opacity: number; lineWidth: number }
> = {
  orange: { key: 'o', color: ANNOTATION_COLORS.O.color, opacity: 1, lineWidth: 10 },
};

export interface ParsedComment {
  /** The comment text with all `[%cal ...]` / `[%csl ...]` tags removed. */
  readonly text: string;
  /** Shapes encoded by the removed tags. */
  readonly shapes: readonly Annotation[];
}

const CAL_TAG = /\[%cal\s+([^\]]*)\]/g;
const CSL_TAG = /\[%csl\s+([^\]]*)\]/g;

function parseColorLetter(ch: string): AnnotationColor | null {
  return ANNOTATION_COLORS[ch as AnnotationColorLetter] ?? null;
}

function parseArrows(body: string, shapes: Annotation[]): void {
  for (const raw of body.split(',')) {
    const entry = raw.trim();
    if (entry.length < 5) {
      continue;
    }
    const color = parseColorLetter(entry[0]!);
    if (!color) {
      continue;
    }
    const from = entry.slice(1, 3);
    const to = entry.slice(3, 5);
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) {
      continue;
    }
    shapes.push({ kind: 'arrow', from, to, color });
  }
}

function parseSquares(body: string, shapes: Annotation[]): void {
  for (const raw of body.split(',')) {
    const entry = raw.trim();
    if (entry.length < 3) {
      continue;
    }
    const color = parseColorLetter(entry[0]!);
    if (!color) {
      continue;
    }
    // A single entry may carry one or more squares: `Rd5` or `Rd5,e5`.
    const squares = entry.slice(1).match(/[a-h][1-8]/g) ?? [];
    for (const square of squares) {
      shapes.push({ kind: 'square', square, color });
    }
  }
}

/**
 * Extracts `%cal` / `%csl` shapes from a single comment string and
 * returns the cleaned-up visible text plus the shapes. Non-shape text
 * is preserved verbatim (trimmed).
 */
export function parseCommentAnnotations(comment: string): ParsedComment {
  const shapes: Annotation[] = [];
  const cleaned = comment
    .replace(CAL_TAG, (_, body: string) => {
      parseArrows(body, shapes);
      return '';
    })
    .replace(CSL_TAG, (_, body: string) => {
      parseSquares(body, shapes);
      return '';
    })
    .trim();
  return { text: cleaned, shapes };
}

/** Collect shapes from a list of raw PGN comment strings. */
export function annotationsFromComments(comments: readonly string[]): readonly Annotation[] {
  const shapes: Annotation[] = [];
  for (const comment of comments) {
    shapes.push(...parseCommentAnnotations(comment).shapes);
  }
  return shapes;
}

export interface NagMeta {
  /** Number as written in PGN (`$1` … `$9`). */
  readonly nag: number;
  /** Symbol rendered after the move. */
  readonly glyph: string;
  /** Stable tone label (used for tests + future move classification). */
  readonly tone: string;
  /** Text / badge color. */
  readonly color: string;
}

const GOOD = '#15781b';
const BRILLIANT = '#0a7a3c';
const MISTAKE = '#c77400';
const BLUNDER = '#c4261c';
const INTERESTING = '#1a56db';
const DUBIOUS = '#a06a00';
const MISS = '#c2185b';

export const NAG_META: Readonly<Record<number, NagMeta>> = {
  1: { nag: 1, glyph: '!', tone: 'good', color: GOOD },
  2: { nag: 2, glyph: '?', tone: 'mistake', color: MISTAKE },
  3: { nag: 3, glyph: '!!', tone: 'brilliant', color: BRILLIANT },
  4: { nag: 4, glyph: '??', tone: 'blunder', color: BLUNDER },
  5: { nag: 5, glyph: '!?', tone: 'interesting', color: INTERESTING },
  6: { nag: 6, glyph: '?!', tone: 'dubious', color: DUBIOUS },
  // Non-standard (Chess.com) "miss" marker. Rendered as a distinct `X`.
  9: { nag: 9, glyph: 'X', tone: 'miss', color: MISS },
};

/** NAG metadata for a numeric NAG, or `null` when not in the table. */
export function nagMeta(nag: number): NagMeta | null {
  return NAG_META[nag] ?? null;
}

/** NAG metadata for the numeric NAGs of a move, in PGN order. */
export function nagsMeta(nags: readonly number[]): NagMeta[] {
  const out: NagMeta[] = [];
  for (const nag of nags) {
    const meta = nagMeta(nag);
    if (meta) {
      out.push(meta);
    }
  }
  return out;
}
