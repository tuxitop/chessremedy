# Feature 023 — Repertoire Creator UI

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation.

## Goal

Let the user build and edit a repertoire visually: browse the position-keyed
DAG, add/remove/annotate moves, merge transpositions, import lines, and export
PGN — on the same board surface the rest of the app uses.

## Idea

A tree/DAG editor hosted on the shared analysis board (ADR-033) with the
Chessground wrapper (ADR-002/014). The user plays moves on the board to add
edges to the repertoire; the UI shows the resulting lines, merges transpositions
by position key (Feature 021), and labels positions with opening names
(Feature 022).

Editing reuses the existing board, move list (`MoveList` on `chessops/pgn`,
ADR-030) and navigation conventions rather than introducing a new board.

## Scope sketch

### In scope

- Repertoire list and per-repertoire editor views (White/Black).
- Play-a-move-to-add / remove / promote an edge; mark side to move.
- Transposition-aware merge when a position already exists in the DAG.
- Import a line or a Lichess-study-style PGN into the current repertoire.
- Export the repertoire to PGN.
- Annotations/comments on nodes (basic).
- Responsive, keyboard- and touch-operable; light and dark themes.

### Out of scope

- Training and review (Feature 024).
- Coverage/gap statistics (025) and compliance (026).
- Bulk import of external courses; multi-repertoire merging UX beyond basics.

## Dependencies

- Feature 021 — repertoire domain + PGN import/export.
- Feature 022 — opening names.
- Feature 006 / ADR-033 — shared analysis board.
- ADR-002 / ADR-014 — Chessground wrapper.
- ADR-030 — move list on `chessops/pgn`.

## Open questions

1. Editing model: free board play vs explicit "add this move to repertoire".
2. How to present transpositions and merged nodes without confusing the user.
3. Where the editor lives (dedicated route vs a mode on the analysis board).
4. Undo/history semantics for repertoire edits.
5. How much annotation UI belongs in the draft vs a later refinement.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §6 UI, §7 storage)
- `.opencode/specs/features/021-opening-repertoire-domain.md`
- `.opencode/specs/features/022-opening-identification-eco.md`
- `.opencode/specs/features/006-live-analysis-board.md`
- `.opencode/specs/decisions/ADR-002-chessground.md`
- `.opencode/specs/decisions/ADR-014-chessground-version.md`
- `.opencode/specs/decisions/ADR-030-drop-pgn-viewer.md`
- `.opencode/specs/decisions/ADR-033-unified-analysis-board.md`
