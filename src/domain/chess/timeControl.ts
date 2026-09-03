/**
 * Normalized time-control model (Feature 003, ADR-013).
 *
 * The original provider string is preserved verbatim on `Game.timeControl`;
 * `normalizeTimeControl` maps it to one of the six canonical categories.
 * The mapping is deterministic and versioned (ADR-013 consequence).
 */

export const TIME_CONTROL_CATEGORIES = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'correspondence',
  'unknown',
] as const;

export type TimeControlCategory = (typeof TIME_CONTROL_CATEGORIES)[number];

export const TIME_CONTROL_NORMALIZATION_VERSION = 1;

export interface NormalizedTimeControl {
  readonly category: TimeControlCategory;
  /** Version of the mapping table that produced `category`. */
  readonly version: number;
}

const UNKNOWN: NormalizedTimeControl = {
  category: 'unknown',
  version: TIME_CONTROL_NORMALIZATION_VERSION,
};

/** Correspondence strings are moves-per-day, e.g. Lichess/Chess.com `1/172800`. */
const CORRESPONDENCE_PATTERN = /^\d+\/\d+$/;

/** Either `initial` seconds or `initial+increment` seconds. */
const CLOCK_PATTERN = /^(\d+)(?:\+(\d+))?$/;

/**
 * Compute the normalized category for a raw provider time-control string.
 *
 * Mapping rules (v1):
 *  - empty / `-` / `?` / anything unparseable → `unknown`
 *  - `moves/seconds` per-move form (correspondence) → `correspondence`
 *  - otherwise parse `initial` or `initial+increment` seconds and compare a
 *    reference time `t = initial + 40 * increment` (when increment > 0)
 *    against the Lichess-style boundaries:
 *      `t <= 179` bullet, `180..479` blitz, `480..1499` rapid, `>= 1500` classical.
 */
export function normalizeTimeControl(raw: string): NormalizedTimeControl {
  const input = raw.trim();
  if (input === '' || input === '-' || input === '?') {
    return UNKNOWN;
  }
  if (CORRESPONDENCE_PATTERN.test(input)) {
    return { category: 'correspondence', version: TIME_CONTROL_NORMALIZATION_VERSION };
  }
  const match = CLOCK_PATTERN.exec(input);
  if (!match) {
    return UNKNOWN;
  }
  const initial = Number(match[1]);
  const increment = match[2] === undefined ? 0 : Number(match[2]);
  const reference = increment > 0 ? initial + 40 * increment : initial;

  let category: TimeControlCategory;
  if (reference <= 179) {
    category = 'bullet';
  } else if (reference <= 479) {
    category = 'blitz';
  } else if (reference <= 1499) {
    category = 'rapid';
  } else {
    category = 'classical';
  }
  return { category, version: TIME_CONTROL_NORMALIZATION_VERSION };
}
