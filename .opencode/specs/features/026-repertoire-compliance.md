# Feature 026 — Repertoire Compliance

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation.

## Goal

Tell the user, for their own imported games, whether they actually followed
their repertoire — and where they deviated.

## Idea

Walk each imported game ply by ply and compare it to the repertoire DAG:

- When it is the user's turn and the played move is an edge in the repertoire,
  the game is **compliant** at that ply.
- A legal move that is not in the repertoire is a **deviation** (with the
  repertoire move(s) shown as the alternative).
- When the opponent leaves the repertoire, that is a **coverage gap** (shared
  with Feature 025), not a user deviation.

Compliance is a read-time projection over stored games (Feature 007) and the
repertoire (021); it mutates no game, analysis or repertoire row.

## Scope sketch

### In scope

- A pure compliance walker over a game + repertoire.
- Per-game and per-line deviation reporting, linked to the analysis board.
- Aggregate compliance over the game library (filters: color, opening, date).
- Surfacing in the Library/Review surfaces without changing stored analysis.

### Out of scope

- Changing or re-classifying move analysis (Features 008/009).
- Auto-adding deviations to the repertoire (a possible later action).
- Non-imported or live games.

## Dependencies

- Feature 021 — repertoire DAG and position keys.
- Feature 007 / 008 — imported games and their move lists.
- Feature 006 / ADR-033 — shared analysis board for viewing a deviation.

## Open questions

1. Exact deviation definition (first deviation only vs every user ply).
2. Whether deviations are cached/derived per game or computed on demand.
3. How to present compliance without conflicting with move classification.
4. Whether a deviation offers a one-click "add this line to my repertoire".
5. Scoping when a game transposes into or out of the repertoire mid-game.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §7 storage)
- `.opencode/specs/features/007-game-import.md`
- `.opencode/specs/features/008-game-analysis.md`
- `.opencode/specs/features/021-opening-repertoire-domain.md`
- `.opencode/specs/decisions/ADR-033-unified-analysis-board.md`
- `.opencode/specs/research/opening-repertoire.md`
