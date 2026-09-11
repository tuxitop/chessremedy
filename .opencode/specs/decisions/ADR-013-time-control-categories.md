# ADR-013: Time-Control Model & Categories

## Status

Accepted (revised 2026-09-11). The original **platform-agnostic**
classification rule is superseded by the **per-platform profiles** in
this ADR. The structured model, the six canonical categories, the indexed
`normalizedTimeControl` column and the versioned re-normalization policy
are unchanged.

## Decision

The canonical V1 normalized time-control categories are:

- bullet
- blitz
- rapid
- classical
- correspondence
- unknown

The original source time-control string is preserved verbatim in
`timeControl`. The canonical category is stored in
`normalizedTimeControl`.

The exact time control (base seconds, increment seconds, days-per-turn,
estimated length) is represented as a structured value object and is
persisted on each game so every consumer (Game Library, Game Analysis,
statistics, charts, filters, reports) uses the same model instead of
re-deriving from the raw string.

**The canonical category is platform-specific.** It is a pure,
deterministic function of the parsed structure and the platform profile
selected from the game's `source`:

| `source`                                    | Profile   |
| ------------------------------------------- | --------- |
| `chesscom`                                  | `chesscom` |
| `lichess`                                   | `lichess`  |
| `local`, `fixture`, any future/unknown source | `generic`  |

Both provider profiles use the same estimated game length,
`base + 40 × increment` seconds; they differ only in the category
boundaries:

| Category         | Lichess profile (`lichess`)                  | Chess.com profile (`chesscom`)                       |
| ---------------- | -------------------------------------------- | ---------------------------------------------------- |
| `bullet`         | estimate ≤ 179 s                             | estimate ≤ 179 s                                     |
| `blitz`          | 180 s ≤ estimate ≤ 479 s                     | 180 s ≤ estimate ≤ 599 s                             |
| `rapid`          | 480 s ≤ estimate ≤ 1499 s                    | estimate ≥ 600 s                                     |
| `classical`      | estimate ≥ 1500 s                            | never produced (long games are `rapid`)              |
| `correspondence` | days-per-move / provider correspondence signal | daily `moves/seconds` / provider daily signal        |
| `unknown`        | unparseable                                  | unparseable                                          |

- Lichess UltraBullet (estimate ≤ 29 s) folds into `bullet`; the source
  label is retained as a hint only.
- Chess.com has no classical category: its `30|0` (and any estimate
  ≥ 1500 s) is `rapid`, matching Chess.com's published rating groups.
- The `generic` profile is the Lichess boundaries, so `local`/`fixture`
  games keep their pre-change classification. It is the documented
  neutral default until a source-specific definition exists.
- A platform's own label (Lichess `speed`, Chess.com `time_class`) is
  kept as an optional hint for display/auditing and never replaces the
  computed canonical category.

The display house style is `M|I` (`5|5`, `10|0`, `3|2`) with fallbacks for
non-whole-minute bases and fractional increments. Raw seconds are never
shown as if they were minutes.

Full rules (parsing dialects, profile tables, display formatter,
versioning, migration) live in `specs/domain/time-control.md`; this ADR
records the decision and its consequences only.

## Reasons

- Chess.com and Lichess publish different boundaries for the same
  estimate: `5+5` (500 s) is Lichess **rapid** but Chess.com **blitz**,
  and Chess.com has no classical (a 30-minute game is `rapid`). A single
  platform-agnostic rule necessarily misclassifies one provider.
- Owner decision: category membership must match the platform that
  produced the game, so filters, rating progress and trends agree with
  what the user sees on that platform.
- Both providers estimate length as `base + 40 × increment`, so the
  structured model and `estimatedSeconds` stay platform-independent;
  only the boundaries vary.
- Correspondence is retained because Lichess and Chess.com both have
  correspondence/daily games that would otherwise be miscategorized.
- Unknown catches non-standard or future time-control values.
- Preserving the original string avoids data loss and enables debugging
  of normalization logic.
- Storing a structured value removes repeated string parsing and lets
  statistics group by exact time control in addition to category.

## Consequences

- The mapping from source string to normalized category is deterministic
  and versioned **per profile**. When a profile or the profile selection
  changes, the category version increments and existing records are
  re-normalized by an explicit, versioned migration (schema v11;
  `specs/domain/time-control.md`).
- The persisted structured value records the `profile` and
  `categoryVersion` that produced `category`, so stale rows are
  identifiable and the backfill is auditable.
- Only games whose profile classification changed are affected: for
  `chesscom`, estimates of 480–599 s move `rapid` → `blitz` and
  estimates ≥ 1500 s move `classical` → `rapid`; `lichess` and
  `local`/`fixture` games keep their category.
- Statistics must distinguish each of the six categories and must never
  silently combine different time controls. A `(platform, timeControl)`
  partition uses that platform's category definition; the same raw clock
  may appear in different categories on different platforms and is never
  merged. `STATISTICS_VERSION` is bumped by the mapping change.
- Mixed-platform or mixed-time-control views must be explicitly labeled
  and are never the default.
- Rating progress is separated by platform and time control.
- The minimum sample size for any displayed aggregate is 5. Below this
  threshold, an "insufficient data" placeholder is shown.
- The structured time control is persisted additively (schema v5); the
  indexed `normalizedTimeControl` column is retained. The
  re-normalization ships as schema v11 and is idempotent.
- Derived time-control fields are recomputed from the verbatim
  `timeControl` on import and on sync merge; they are never trusted from
  a remote payload (Feature 016).

## Sources

- `specs/domain/time-control.md` (canonical rules)
- `specs/PRODUCT.md` section 6
- `specs/domain/game-model.md`
- `specs/domain/statistics.md`
- Lichess FAQ "How are Bullet, Blitz and other time controls decided?"
  (estimated duration `initial + 40 × increment`; ≤ 29 s UltraBullet,
  ≤ 179 s Bullet, ≤ 479 s Blitz, ≤ 1499 s Rapid, ≥ 1500 s Classical)
  and scalachess `Speed.scala` / `Clock.scala`
- Chess.com Help "Why are there different ratings in live chess?"
  (Bullet under 3 min, Blitz over 3 and under 10 min, Rapid 10 min and
  longer, estimated over 40 moves) and Chess.com PubAPI `time_class`
- chess.com & lichess PGN exports
