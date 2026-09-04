/**
 * Time-control model — canonical (Feature 003 + revised Feature 008).
 *
 * `specs/domain/time-control.md` / ADR-013 are the source of truth.
 * The exact time control (base, increment, days-per-turn, estimated
 * length) is a structured value kept separate from its **category**. The
 * original provider string is preserved verbatim; parsing, classification
 * and display are single deterministic, versioned domain functions so the
 * UI and statistics never re-derive time-control rules.
 *
 * Provider dialects (inputs):
 *  - clock seconds: `180+2`, `60+0` (Lichess), `180`, `60+1` (Chess.com),
 *    fractional increment `10+0.1`
 *  - correspondence: `1/259200` (Chess.com daily), `"14 days per move"`
 *    (Lichess)
 *  - unknown / no clock: `-`, `?`, empty, unparseable
 *
 * Classification is platform-agnostic (estimated length `base + 40 ×
 * increment`): bullet ≤ 179 s, blitz 180–479 s, rapid 480–1499 s,
 * classical ≥ 1500 s; no clock ⇒ correspondence; unparseable ⇒ unknown.
 *
 * Display is `M|I` house style (`5|5`, `10|0`, `3|2`); raw seconds are
 * never shown as if they were minutes.
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

export type TimeControlKind = 'clock' | 'correspondence' | 'unknown';

export const TIME_CONTROL_PARSE_VERSION = 1;
export const TIME_CONTROL_CATEGORY_VERSION = 1;
/** Back-compat alias for the category mapping version. */
export const TIME_CONTROL_NORMALIZATION_VERSION = TIME_CONTROL_CATEGORY_VERSION;

export interface NormalizedTimeControl {
  readonly category: TimeControlCategory;
  /** Version of the mapping table that produced `category`. */
  readonly version: number;
}

/** Structured exact time control (canonical model). */
export interface TimeControl {
  /** Original provider string, verbatim. */
  readonly raw: string;
  readonly kind: TimeControlKind;
  /** Seconds of base time; `null` for correspondence/unknown. */
  readonly baseSeconds: number | null;
  /** Seconds of increment per move; `0` when absent; `null` otherwise. */
  readonly incrementSeconds: number | null;
  /** Days per move (correspondence); `null` otherwise. */
  readonly daysPerTurn: number | null;
  /** Estimated length `base + 40 × increment` (seconds); `null` otherwise. */
  readonly estimatedSeconds: number | null;
  /** Canonical platform-agnostic category. */
  readonly category: TimeControlCategory;
  readonly categoryVersion: number;
  readonly parseVersion: number;
  /** House-style label (`5|5`, `10|0`, `3 days/move`, `Unknown`). */
  readonly display: string;
}

const SECONDS_PER_DAY = 86_400;

/** Lichess correspondence: `"14 days per move"` / `"1 day per move"`. */
const DAYS_PER_MOVE_PATTERN = /^(\d+(?:\.\d+)?)\s+day(?:s)?\s+per\s+move$/i;

/** Chess.com daily: `{moves}/{seconds}` (e.g. `1/259200`). */
const MOVES_PER_SECONDS_PATTERN = /^(\d+)\s*\/\s*(\d+)$/;

/** Clock: `{seconds}` or `{seconds}+{increment}` (increment may be fractional). */
const CLOCK_PATTERN = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/;

function isNoClock(input: string): boolean {
  return input === '' || input === '-' || input === '?' || input.toLowerCase() === 'unknown';
}

function displayDays(days: number): string {
  const rounded = Math.round(days * 1000) / 1000;
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}/move`;
}

/** Trim a numeric token for display (`300` → `300`, `0.1` → `0.1`). */
function numberToken(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

/** Display a whole-minute base as minutes, else keep exact seconds. */
function displayBase(baseSeconds: number): string {
  if (baseSeconds % 60 === 0) {
    return String(baseSeconds / 60);
  }
  return String(baseSeconds);
}

function displayClock(baseSeconds: number, incrementSeconds: number): string {
  return `${displayBase(baseSeconds)}|${numberToken(incrementSeconds)}`;
}

/** Deterministic canonical category from a parsed clock (ADR-013). */
function classifyClock(baseSeconds: number, incrementSeconds: number): TimeControlCategory {
  const estimate = baseSeconds + 40 * incrementSeconds;
  if (estimate <= 179) {
    return 'bullet';
  }
  if (estimate <= 479) {
    return 'blitz';
  }
  if (estimate <= 1499) {
    return 'rapid';
  }
  return 'classical';
}

/**
 * Parse a provider time-control string into the structured canonical model.
 * The original string is preserved verbatim and never interpreted as if its
 * units were minutes.
 */
export function parseTimeControl(raw: string): TimeControl {
  const input = raw.trim();

  if (isNoClock(input)) {
    return {
      raw,
      kind: 'unknown',
      baseSeconds: null,
      incrementSeconds: null,
      daysPerTurn: null,
      estimatedSeconds: null,
      category: 'unknown',
      categoryVersion: TIME_CONTROL_CATEGORY_VERSION,
      parseVersion: TIME_CONTROL_PARSE_VERSION,
      display: 'Unknown',
    };
  }

  const daysMatch = DAYS_PER_MOVE_PATTERN.exec(input);
  if (daysMatch) {
    const days = Number(daysMatch[1]);
    return {
      raw,
      kind: 'correspondence',
      baseSeconds: null,
      incrementSeconds: null,
      daysPerTurn: days,
      estimatedSeconds: null,
      category: 'correspondence',
      categoryVersion: TIME_CONTROL_CATEGORY_VERSION,
      parseVersion: TIME_CONTROL_PARSE_VERSION,
      display: displayDays(days),
    };
  }

  const fractionMatch = MOVES_PER_SECONDS_PATTERN.exec(input);
  if (fractionMatch) {
    // Chess.com daily is always one move per N seconds. Any other
    // `moves/seconds` shape is unsupported → unknown (never guessed).
    const moves = Number(fractionMatch[1]);
    const seconds = Number(fractionMatch[2]);
    if (moves === 1 && Number.isFinite(seconds) && seconds > 0) {
      const days = seconds / SECONDS_PER_DAY;
      return {
        raw,
        kind: 'correspondence',
        baseSeconds: null,
        incrementSeconds: null,
        daysPerTurn: days,
        estimatedSeconds: null,
        category: 'correspondence',
        categoryVersion: TIME_CONTROL_CATEGORY_VERSION,
        parseVersion: TIME_CONTROL_PARSE_VERSION,
        display: displayDays(days),
      };
    }
    return {
      raw,
      kind: 'unknown',
      baseSeconds: null,
      incrementSeconds: null,
      daysPerTurn: null,
      estimatedSeconds: null,
      category: 'unknown',
      categoryVersion: TIME_CONTROL_CATEGORY_VERSION,
      parseVersion: TIME_CONTROL_PARSE_VERSION,
      display: 'Unknown',
    };
  }

  const clockMatch = CLOCK_PATTERN.exec(input);
  if (clockMatch) {
    const baseSeconds = Number(clockMatch[1]);
    const incrementSeconds = clockMatch[2] === undefined ? 0 : Number(clockMatch[2]);
    if (Number.isFinite(baseSeconds) && Number.isFinite(incrementSeconds)) {
      return {
        raw,
        kind: 'clock',
        baseSeconds,
        incrementSeconds,
        daysPerTurn: null,
        estimatedSeconds: baseSeconds + 40 * incrementSeconds,
        category: classifyClock(baseSeconds, incrementSeconds),
        categoryVersion: TIME_CONTROL_CATEGORY_VERSION,
        parseVersion: TIME_CONTROL_PARSE_VERSION,
        display: displayClock(baseSeconds, incrementSeconds),
      };
    }
  }

  return {
    raw,
    kind: 'unknown',
    baseSeconds: null,
    incrementSeconds: null,
    daysPerTurn: null,
    estimatedSeconds: null,
    category: 'unknown',
    categoryVersion: TIME_CONTROL_CATEGORY_VERSION,
    parseVersion: TIME_CONTROL_PARSE_VERSION,
    display: 'Unknown',
  };
}

/**
 * Compute the normalized category for a raw provider time-control string
 * (legacy API kept for back-compat; new code prefers `parseTimeControl`).
 */
export function normalizeTimeControl(raw: string): NormalizedTimeControl {
  return {
    category: parseTimeControl(raw).category,
    version: TIME_CONTROL_CATEGORY_VERSION,
  };
}
