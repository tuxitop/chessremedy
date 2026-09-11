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

### Missed-tactic exclusivity (ADR-023 amendment)

A ply whose analysis carries a **current-version verified missed tactic**
(`MoveAnalysis.missedTactic === true` with `detectionVersion ===
DETECTION_VERSION`, or a `verified` candidate for the same
`[analysisId, sourcePly]` at the current `DETECTION_VERSION`) is **exclusive**:

- Its persisted ADR-023 label is the raw classifier output and is retained as
  provenance, but the ply's **effective classification** is the derived state
  `missedTactic` — a presentation/statistics state, **not** a sixth persisted
  `MoveClassification` and **not** a `classificationVersion` change.
- Game Review renders **exactly one** annotation, the canonical missed-tactic
  marker (NAG 9, `MISSED_TACTIC_NAG`); the negative-classification glyph,
  colour, board chip and start/end-square highlight are suppressed. The move
  must never render both a classification glyph and the missed-tactic glyph.
- The per-game classification counts and the accuracy tooling's own count
  helpers exclude the ply from all five buckets; it is counted only as a missed
  tactic (`userMissedTactics`). Move-exposure counts (`userMoves`) keep the ply.
- **Accuracy is unchanged.** ADR-024 computes per-move accuracy from the
  persisted evaluations and includes the ply; accuracy is a quality metric and
  is never derived from glyph presence, classification emphasis or detection
  state. *(Owner-confirmable: the alternative is to exclude the ply from the
  ADR-024 `accuracyMoves` weight; that requires an ADR-024 amendment and a
  `MOVE_ACCURACY_VERSION` bump.)*
- Exclusivity is gated by the Feature-010 freshness rule: a marker from an
  older `detectionVersion` is suppressed, so the ply renders and counts as its
  raw ADR-023 classification until a fresh scan re-derives it.
- Before a current completed detection pass exists for the analysis, the
  missed-tactic determination does not exist yet and the raw ADR-023 counts
  apply; when the pass completes, the per-analysis summary is rebuilt under
  this rule (Feature 010).

## Accuracy

Accuracy is calculated from persisted analysis data and must not be
derived from glyph presence or from which states are emphasized; it is
computed from persisted evaluations per ADR-024. Missed-tactic
exclusivity does **not** change accuracy: a current-version verified
missed-tactic ply is included in the per-move accuracy and in the
`accuracyMoves` denominator (ADR-023 amendment).

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
engine-equal or ordinary move is not an error. A current-version verified
missed-tactic ply is **exclusive**: it renders only the missed-tactic marker
and its classification glyph/colour are suppressed (see "Missed-tactic
exclusivity" above). Review display derives
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
- The `inaccuracy` / `mistake` / `blunder` counts **exclude** a
  current-version verified missed-tactic ply (ADR-023 amendment); such a ply
  is counted only by the Missed-tactics row. Before a current completed
  detection pass the raw counts apply.
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
- [ ] A current-version verified missed-tactic ply renders **only** the
      missed-tactic marker (NAG 9) — never a classification glyph alongside it
      — and is excluded from every classification count in the per-game
      summary (the earlier double-annotation behavior is superseded).
- [ ] Accuracy is unchanged by missed-tactic exclusivity: the ply stays in the
      ADR-024 per-move accuracy and the `accuracyMoves` denominator.
- [ ] A missed-tactic marker from an older `detectionVersion` is suppressed and
      the ply renders/counts as its raw ADR-023 classification.
- [ ] Classification version is preserved.
- [ ] Tooling is deterministic over persisted MoveAnalysis fixtures and
      never rewrites a stored classification or its version.

## Testing

- [ ] Summary fixtures with a current-version verified missed-tactic ply assert
      that the ply is absent from all five classification counts and present in
      `userMissedTactics`; the same fixture at a stale `detectionVersion` counts
      the ply in its raw bucket instead.
- [ ] The Game Review component test that previously asserted **both** the
      classification NAG and the missed-tactic NAG
      (`GameReviewPage.test.tsx` › "renders the classification glyph plus the
      missed-tactic marker for a verified miss") flips to assert **exactly one**
      annotation (the missed-tactic marker) and no classification
      glyph/colour/highlight for the exclusive ply, and its
      `summary-user-blunder-value` assertion flips from `1` to `0` (the ply is
      counted only as a missed tactic).
- [ ] Accuracy fixtures assert the exclusive ply remains in the per-move
      accuracy set and the `accuracyMoves` denominator.
- [ ] `classificationVersion` stays `2` for fixtures produced before and after
      the amendment (the amendment is not a classifier change).