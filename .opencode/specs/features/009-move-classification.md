# Feature 009 — Classification & Accuracy Tooling

## Goal

Provide presentation and accuracy tooling over the classifications and
engine analyses persisted by Feature 008.

Feature 009 does not classify moves.

The canonical classifier is a chess-domain rule applied by Feature 008.

Feature 009 never changes classifications or versions; it consumes the
total five-state `MoveAnalysis` records produced by Feature 008 and
defines how the UI renders and explains them (ordinary `good` moves are
not emphasized).

## Scope

- Classification glyph rendering.
- Classification labels and explanations.
- Per-game classification summaries.
- Accuracy calculations.
- Statistics helpers.
- Deterministic fixtures and tests.

## Classification

Every persisted `MoveAnalysis` carries exactly one ADR-023 classification:
`best`, `good`, `inaccuracy`, `mistake` or `blunder`. There is no
`null`/unclassified data state in V1.

"Unclassified" exists only **in presentation**: it denotes ordinary,
non-emphasized moves, which are the `good` bucket.

Ordinary (`good`) moves:

- show no classification glyph;
- remain fully navigable;
- still have their engine evaluation available;
- are still displayed in the move list.

Only classifications whose quality warrants emphasis render glyphs.
The canonical classification→NAG mapping is Feature-009 tooling
(`classificationMeta`, single source) based on the ADR-023 states:

| Classification | NAG glyph  | Use |
|----------------|------------|-----|
| `best`         | `!!` (NAG 3) | canonical persisted/PGN-export mapping (see below); **not** rendered as an emphasized `!!` in Review |
| `good`         | none         | ordinary/unemphasized |
| `inaccuracy`   | `?!` (NAG 6) | negative-class annotation |
| `mistake`      | `?` (NAG 2)  | negative-class annotation |
| `blunder`      | `??` (NAG 4) | negative-class annotation |

Presentation emphasis is **separate from the persisted five-state label**.
In Game Review the move list and board square highlights annotate **only
the negative classes** (`inaccuracy` / `mistake` / `blunder`, plus the
Feature-010 missed-tactic marker); `best`/`good` render **quiet** (no NAG,
no colour). NAG `!!` (3) is therefore **reserved for a future
brilliant-move detector** — it is kept as the canonical NAG for `best`
only in the persisted/PGN-export mapping and is never rendered as an
emphasized `!!` for ordinary engine-equal moves (see Game Review).

## Accuracy

Accuracy is calculated from persisted analysis data and must not be
derived from glyph presence or from which states are emphasized; it is
computed from persisted evaluations per ADR-024.

Accuracy calculations must follow ADR-024 and the relevant research.

Where an accuracy value is shown to the user it is displayed with **one
decimal** through the shared Feature-009 helper `formatAccuracy(value,
{ decimals: 1 })` (Library row insights strip, Game Review Summary
headline); the stored value stays the full float, and the helper renders
"no usable moves" consistently (omitted / em-dash, never `0`).

## Canonical classification colours (single source)

One canonical palette lives in the UI module `classificationColors.ts`
(single source of truth) and is reused wherever a classification colour is
shown — move-list glyph colours, board square highlights, the Review
Summary counts and the Library insight counts:

| Classification | Colour    |
|----------------|-----------|
| `best`         | `#15781b` |
| `good`         | `#15781b` |
| `inaccuracy`   | `#d89000` |
| `mistake`      | `#d94f00` |
| `blunder`      | `#c4261c` |
| missed tactic  | `#c2185b` |

**Inaccuracy vs mistake must stay visually distinct**: `#d89000` (amber)
and `#d94f00` (orange) differ clearly in hue/tone, and a distinctness test
guards their distance so the two classes are never collapsed onto
near-identical tones. Colour never carries information alone — glyphs,
labels and text use the same colour/tone alongside the colour.

## Game Review

The Review UI should emphasize classified moves rather than visually
classifying every move.

Users must be able to navigate every move and inspect its evaluation,
while meaningful mistakes/blunders/etc. are visually highlighted.

**Review presentation default ("annotate only negative").** The move list
colours/annotates **only** `inaccuracy | mistake | blunder`, each with its
canonical glyph and colour, plus the Feature-010 missed-tactic marker.
`best` and `good` render **quiet** — no NAG, no colour — because an
engine-equal or ordinary move is not an error. Review display derives
glyphs/labels/colours from the canonical Feature-009 mapping and never
redefines them locally; the annotate-only-negative rule is a presentation
choice and does not change the persisted label or `classificationMeta`'s
canonical NAG mapping (`best` → NAG 3 stays for PGN/export).

On the board:

- Square highlights (start/end squares of the selected move) apply **only
  to the negative classes** (replacing the plain last-move highlight);
  `best`/`good` keep the default last-move highlight.
- The classification chip anchored to the selected move's destination
  square (SquareBadges style/formatting, as the Playground's NAG badges)
  renders for the negative classes. `best` may show a **quiet `★` star
  board badge instead — never the `!!` glyph**; ordinary `good` moves and
  positions without a played move show nothing. NAG `!!` stays reserved
  for a future brilliant-move detector.
- Colour is never the only signal — the canonical glyph/label on the
  chip, the move list and the summary use the same classification
  colour/tone.

When live analysis is on, moves played/explored on the board are also
classified ephemerally from the live engine evaluations (ADR-023) and
follow the same "annotate only negative" presentation (glyph, chip,
start/end-square highlight). These ephemeral classifications never write
into or override the persisted `MoveAnalysis`.

## Review Summary

The Review Summary count values are coloured by the canonical palette
above, with the zero rules:

- `inaccuracy` / `mistake` / `blunder` / missed tactics read **green when
  `0`**, else the class colour (a zero is good news; a non-zero count is
  the class's own warning colour).
- `best` / `good` are **neutral when `0`** (no classification colour).
- The Missed-tactics row appears only when a Feature-010 detection pass
  completed for the shown analysis (a real `0` then; absent otherwise).
- Screen-reader text spells out every value; the counts are never
  colour-only.

## Acceptance Criteria

- [ ] Every persisted `MoveAnalysis` carries exactly one of the five
      ADR-023 classifications; no `null` classification is produced in V1.
- [ ] Most ordinary moves in representative fixtures are classified
      `good` and are presented without emphasis.
- [ ] Opening/book-like ordinary moves are `good` and are not visually
      emphasized merely because they were analyzed.
- [ ] `inaccuracy`/`mistake`/`blunder` display the canonical negative
      glyph; `good` and `best` display none in the Review move list (`best`
      may show a quiet `★` board badge; NAG `!!` is never rendered for it).
- [ ] Ordinary (`good`) moves display no classification glyph.
- [ ] Evaluation remains available for ordinary (`good`) moves.
- [ ] Accuracy is computed from persisted evaluations (ADR-024) and never
      depends on glyph presence or on classification emphasis.
- [ ] The canonical palette in `classificationColors.ts` keeps inaccuracy
      visually distinct from mistake.
- [ ] Review Summary counts apply the zero rules (negative classes green at
      zero; `best`/`good` neutral at zero).
- [ ] Classification version is preserved.
- [ ] Tooling is deterministic over persisted MoveAnalysis fixtures and
      never rewrites a stored classification or its version.