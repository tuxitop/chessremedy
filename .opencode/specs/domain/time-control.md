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

Platforms publish different category boundaries for the same clock (e.g.
Chess.com calls `5+5` blitz, Lichess rapid; Chess.com has no classical and
calls a 30-minute game rapid). The **category is therefore platform-specific**:
each game is classified with the published definition of the platform that
produced it. The exact time control stays platform-independent, so identical
physical clocks are still represented identically. A platform's own label
(Lichess `speed`, Chess.com `time_class`) is retained as an optional hint for
display/auditing and is never used as the canonical category.

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

## Platform profiles

The profile is selected from the game's `source` (never from the raw string
and never from the platform label):

| `source` | Profile | Definition source |
|---|---|---|
| `chesscom` | `chesscom` | Chess.com Help, "Why are there different ratings in live chess?" |
| `lichess` | `lichess` | Lichess FAQ, "How are Bullet, Blitz and other time controls decided?" |
| `local`, `fixture`, any future/unknown source | `generic` | Lichess boundaries (neutral default; preserves the pre-profile behavior of local games) |

Both provider profiles estimate game length as `base + 40 × increment`
seconds; only the boundaries differ. The `generic` profile is identical to
`lichess`.

### `lichess` profile

| Category | Condition |
|---|---|
| `bullet` | estimate ≤ 179 s |
| `blitz` | 180 s ≤ estimate ≤ 479 s |
| `rapid` | 480 s ≤ estimate ≤ 1499 s |
| `classical` | estimate ≥ 1500 s |
| `correspondence` | days-per-move or provider correspondence signal |
| `unknown` | unparseable |

Lichess publishes `≤ 29 s` as UltraBullet; ChessRemedy folds it into
`bullet` (recorded in the optional platform hint only).

### `chesscom` profile

| Category | Condition |
|---|---|
| `bullet` | estimate ≤ 179 s |
| `blitz` | 180 s ≤ estimate ≤ 599 s |
| `rapid` | estimate ≥ 600 s |
| `correspondence` | daily `moves/seconds` or provider daily signal |
| `unknown` | unparseable |
| `classical` | never produced; Chess.com has no classical group |

Chess.com's published rating groups are "Bullet under 3 minutes", "Blitz
over 3 minutes and under 10 minutes" and "Rapid 10 minutes and longer", using
the same 40-move estimate. Worked examples: `5|5` (500 s) → `blitz`;
`2|12` (600 s) → `rapid`; `30|0` (1800 s) → `rapid` (not `classical`).

### `generic` profile

Identical to `lichess`. It is the documented neutral default for `local`,
`fixture` and any future/unknown source, and preserves the classification
those games had before the platform profiles were introduced.

### Thresholds (owner confirmation)

The exact thresholds above are the ones this spec proposes. The Lichess and
Chess.com boundaries are taken from their published definitions; the only
discretionary choices are:

- `generic` equals Lichess (alternative: a distinct OTB/neutral profile);
- Chess.com estimates ≥ 1500 s map to `rapid`, not `classical` (Chess.com
  has no classical group);
- UltraBullet folds into `bullet` (no seventh category).

## Canonical classification

Versioned, deterministic. The category is computed only from the parsed
structure and the selected platform profile — never from the raw string
alone, never from the base time alone, and never from the platform label.

| Category | Condition |
|---|---|
| `bullet` | profile `lichess`/`generic`: estimate ≤ 179 s; profile `chesscom`: estimate ≤ 179 s |
| `blitz` | profile `lichess`/`generic`: 180–479 s; profile `chesscom`: 180–599 s |
| `rapid` | profile `lichess`/`generic`: 480–1499 s; profile `chesscom`: ≥ 600 s |
| `classical` | profile `lichess`/`generic`: estimate ≥ 1500 s; profile `chesscom`: never |
| `correspondence` | no clock: daily (`moves/seconds`), days-per-turn, or a provider correspondence signal (all profiles) |
| `unknown` | anything unparseable (`-`, `?`, garbage, unsupported shapes) — never silently guessed (all profiles) |

## Domain API

`TimeControlCategory` is unchanged (the six values above). The classification
input adds a profile and the persisted value records it:

```ts
export type TimeControlProfile = 'lichess' | 'chesscom' | 'generic';

/** Map a game origin to its classification profile. */
export function timeControlProfileForSource(source: GameSource): TimeControlProfile;

/** Parse + classify. `profile` is required for canonical classification. */
export function parseTimeControl(raw: string, profile: TimeControlProfile): TimeControl;
export function normalizeTimeControl(
  raw: string,
  profile: TimeControlProfile,
): NormalizedTimeControl;
```

- `TimeControl` and `NormalizedTimeControl` gain a `profile` field;
  `TimeControl.categoryVersion` records the mapping version.
- `TIME_CONTROL_PARSE_VERSION` and `TIME_CONTROL_CATEGORY_VERSION` are
  separate. `TIME_CONTROL_CATEGORY_VERSION` is **2** (the first
  platform-specific mapping; version 1 was the platform-agnostic rule).
- Display-only call sites may pass the `generic` profile because
  `TimeControl.display` is profile-independent; every persisted or
  filtered game category must use `timeControlProfileForSource(game.source)`.
- `Game.normalizedTimeControl` remains one of the six `TimeControlCategory`
  values; only how it is derived changes.

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

Both the parser and the category mapping are versioned. `parseVersion`
changes when parsing changes; `categoryVersion` changes when any profile's
boundaries or the profile selection change. The persisted `TimeControl`
records the `profile` and `categoryVersion` that produced its `category`.
Stored records retain the version that produced them and are re-normalized by
an explicit migration (below).

## Migration and re-normalization

`normalizedTimeControl` (indexed) and `timeControlModel.category` are derived
values, so a mapping change requires a versioned backfill:

- **Schema:** `PERSISTENCE_SCHEMA_VERSION` moves 10 → 11. The v11 Dexie
  `.upgrade()` re-normalizes every `games` row from its verbatim
  `timeControl` and its `source` profile, writing both `timeControlModel`
  (`profile`, `categoryVersion: 2`) and `normalizedTimeControl`.
- **No store-shape change:** no table or index is added. The version bump
  exists solely to guarantee the one-time, transactional upgrade for every
  existing database. This is deliberately a schema bump rather than an ad-hoc
  in-place pass: Dexie's versioned `upgrade()` is the only hook guaranteed to
  run once on every existing installation, whereas an unversioned maintenance
  pass could be skipped and would leave `categoryVersion: 1` rows behind.
- **Idempotency:** the category is a pure function of `(timeControl, source)`.
  Re-running the upgrade yields byte-identical rows; rows already at
  `categoryVersion: 2` may be skipped as an optimization, never as a
  correctness requirement.
- **Affected rows:** only `chesscom` games whose estimate is 480–599 s
  (`rapid` → `blitz`) or ≥ 1500 s (`classical` → `rapid`) change. `lichess`,
  `local` and `fixture` games keep their category.
- **Sync:** the raw `timeControl` is the source of truth; the derived
  `timeControlModel`/`normalizedTimeControl` are recomputed on import and on
  sync merge and are never trusted from a remote payload (Feature 016). A
  device that has not migrated cannot reintroduce a stale category.

## Statistics

Statistics must separate the canonical categories and must never silently
combine different categories (ADR-013, `domain/statistics.md`). Categories
are platform-correct: a partition is `(platform, category)`, and the same raw
clock may fall into different categories on different platforms (e.g. `5|5`
is Lichess `rapid`, Chess.com `blitz`). When a platform filter is `all`,
platform and category stay separate dimensions. Where useful, aggregates may
additionally group by the exact time control; such groupings must be labeled
with the exact control. Changing the category mapping bumps
`STATISTICS_VERSION` (Feature 014).
