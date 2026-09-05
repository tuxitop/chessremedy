# Feature 009 — Classification & Accuracy Tooling

## Goal

Provide presentation and accuracy tooling over the classifications and
engine analyses persisted by Feature 008.

Feature 009 does not classify moves.

The canonical classifier is a chess-domain rule applied by Feature 008.

## Scope

- Classification glyph rendering.
- Classification labels and explanations.
- Per-game classification summaries.
- Accuracy calculations.
- Statistics helpers.
- Deterministic fixtures and tests.

## Classification

A persisted MoveAnalysis may have no classification.

The UI must NOT assume every analyzed move has a classification.

Unclassified moves:

- show no classification glyph;
- remain fully navigable;
- still have their engine evaluation available;
- may still be displayed in the move list.

Only classified moves receive classification glyphs such as:

    ??  ?  ?!  !  !!

The exact mapping is defined by ADR-023.

## Accuracy

Accuracy is calculated from persisted analysis data and must not be
derived from the presence or absence of classification glyphs.

Accuracy calculations must follow ADR-024 and the relevant research.

## Game Review

The Review UI should emphasize classified moves rather than visually
classifying every move.

Users must be able to navigate every move and inspect its evaluation,
while meaningful mistakes/blunders/etc. are visually highlighted.

## Acceptance Criteria

- [ ] Unclassified moves are supported by the data model.
- [ ] Most ordinary moves in representative fixtures remain
      unclassified.
- [ ] Opening/book-like ordinary moves are not automatically classified
      merely because they were analyzed.
- [ ] Classified moves display the appropriate glyph.
- [ ] Unclassified moves display no classification glyph.
- [ ] Evaluation remains available for unclassified moves.
- [ ] Accuracy calculations do not depend on every move having a
      classification.
- [ ] Classification version is preserved.
- [ ] Tooling is deterministic over persisted MoveAnalysis fixtures.