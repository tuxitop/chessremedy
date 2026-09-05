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
The canonical classification→glyph/label/explanation mapping is Feature-009
tooling (single source), based on the ADR-023 states:

| Classification | Glyph (NAG) | Presentation |
|----------------|-------------|--------------|
| `best`         | `!!` (NAG 3) | emphasized   |
| `good`         | none        | ordinary/unemphasized |
| `inaccuracy`   | `?!` (NAG 6) | emphasized  |
| `mistake`      | `?` (NAG 2)  | emphasized  |
| `blunder`      | `??` (NAG 4) | emphasized  |

## Accuracy

Accuracy is calculated from persisted analysis data and must not be
derived from glyph presence or from which states are emphasized; it is
computed from persisted evaluations per ADR-024.

Accuracy calculations must follow ADR-024 and the relevant research.

## Game Review

The Review UI should emphasize classified moves rather than visually
classifying every move.

Users must be able to navigate every move and inspect its evaluation,
while meaningful mistakes/blunders/etc. are visually highlighted.

Ordinary `good` moves are rendered exactly like unemphasized moves: no
glyph, no highlight, full navigation and stored evaluation. Review display
derives glyphs/labels/explanations from the canonical Feature-009 mapping
and never redefines them locally.

The classification glyph of the selected move is also surfaced as a small
board chip anchored to that move's destination square, using the same
SquareBadges style/formatting as the Playground's NAG badges. An
emphasized classification (`best`/`inaccuracy`/`mistake`/`blunder`) shows
its chip; ordinary `good` moves and positions without a played move show
none. The live-overlay path follows the same rule from the ephemeral
classification.

## Acceptance Criteria

- [ ] Every persisted `MoveAnalysis` carries exactly one of the five
      ADR-023 classifications; no `null` classification is produced in V1.
- [ ] Most ordinary moves in representative fixtures are classified
      `good` and are presented without emphasis.
- [ ] Opening/book-like ordinary moves are `good` and are not visually
      emphasized merely because they were analyzed.
- [ ] `best`/`inaccuracy`/`mistake`/`blunder` display the canonical
      glyph; `good` displays none.
- [ ] Ordinary (`good`) moves display no classification glyph.
- [ ] Evaluation remains available for ordinary (`good`) moves.
- [ ] Accuracy is computed from persisted evaluations (ADR-024) and never
      depends on glyph presence or on classification emphasis.
- [ ] Classification version is preserved.
- [ ] Tooling is deterministic over persisted MoveAnalysis fixtures and
      never rewrites a stored classification or its version.