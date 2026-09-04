# Time Control

Canonical time-control model for ChessRemedy. Single source of truth for how
provider time-control strings are **parsed**, **classified** and **formatted**
across the product (Game model, Game Library, Game Analysis, statistics,
charts, filters, reports). Consumers never re-derive time-control rules.

## Values and concepts

Two concepts are always kept separate:

- the **exact time control** (structured: base, increment, days-per-turn);
- its **category** (bullet / blitz / rapid / classical / correspondence /
  unknown).

Platforms disagree on some boundaries (e.g. Chess.com calls `5+5` blitz,
Lichess rapid; Chess.com has no classical and calls long games rapid). The
**canonical category is therefore platform-agnostic**: identical physical
clocks classify identically regardless of which site produced the game. A
platform's own label (Lichess `speed`, Chess.com `time_class`) is retained as
an optional hint for display/auditing and is never used as the canonical
category.

## Raw representation dialects (inputs)

Providers write the PGN `TimeControl` tag in different dialects. The parser
accepts all of them and **preserves the original string verbatim**:

| Dialect | Shape | Example | Meaning |
|---|---|---|---|
| Clock, seconds (Lichess) | `{base}+{inc}`, always includes `+0` | `180+2`, `60+0` | base seconds, increment seconds |
| Clock, seconds (Chess.com) | `{base}` or `{base}+{inc}` (`+0` omitted) | `180`, `60+1` | base seconds, increment seconds |
| Fractional increment | `{base}+{inc.frac}` | `10+0.1` | sub-second increment; keep verbatim |
| Chess.com daily | `{moves}/{seconds}` | `1/259200` | one move per N seconds (3 days) |
| Lichess correspondence | `"N day(s) per move"` | `14 days per move` | days per move |
| Unknown / no clock | `-`, `?`, empty, unparseable | `-` | no parsable time control |

## Canonical classification

Versioned, deterministic. Rule (estimated game length = `base + 40 ×
increment` seconds, the common Lichess/Chess.com heuristic):

| Category | Condition |
|---|---|
| `bullet` | estimate ≤ 179 s (Lichess `ultraBullet`, < 30 s, folds into `bullet` and is recorded in the platform hint only) |
| `blitz` | 180 s ≤ estimate ≤ 479 s |
| `rapid` | 480 s ≤ estimate ≤ 1499 s |
| `classical` | estimate ≥ 1500 s |
| `correspondence` | no clock: daily (`moves/seconds`), days-per-turn, or a provider correspondence signal |
| `unknown` | anything unparseable (`-`, `?`, garbage, unsupported shapes) — never silently guessed |

Category is computed only from the parsed structure, never from the raw
string alone and never from the base time alone.

## Display (house style)

A single formatter renders time controls; the UI never shows raw seconds.

- Realtime clocks: `{wholeMinutes}|{incrementSeconds}`, increment **always
  shown** including `0` — e.g. `5|5`, `10|0`, `3|2`, `15|10`.
- Non-whole-minute base, or fractional increment: exact base seconds then
  increment, e.g. `45|0` for `45+0`, `10|0.1` for `10+0.1`.
- Correspondence: `"{days} days/move"` (from both `1/86400` and
  `"14 days per move"`).
- Unknown: `Unknown`.

The formatted display of a game must never show the parsed seconds value as if
it were minutes (e.g. a `5|5` game must render `5|5`, never a raw or estimated
seconds artifact).

## Versioning

Both the parser and the classifier are versioned. When either changes, the
version increments; stored records retain the version that produced them and
may be re-normalized by an explicit migration (see ADR-013 consequences).

## Statistics

Statistics must separate the canonical categories and must never silently
combine different categories (ADR-013, `domain/statistics.md`). Where useful,
aggregates may additionally group by the exact time control; such groupings
must be labeled with the exact control.
