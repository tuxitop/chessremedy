# Feature 021 — Opening Repertoire Domain & PGN Import/Export

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation. The repertoire-model ADR will be written when
> the spec is finalized.

## Goal

Define the opening-repertoire domain model and the PGN import/export path. This
is the foundation every later opening feature (creator UI, trainer, coverage,
compliance) builds on. No user-facing UI beyond import/export.

## Idea

A repertoire is a **position-keyed DAG**, not a tree, because the same position
arises from different move orders (transpositions). Following
`research/opening-repertoire.md`:

- Nodes are positions identified by a **canonical EPD key**: piece placement,
  side to move, castling rights, and en passant **only when a legal capture
  exists**; move counters are excluded.
- Moves are labelled **edges**; de-duplicating by position key merges
  transpositions automatically.
- **Side selection** (White/Black) marks which edges are the user's to recall;
  opponent moves are prompts/branches.
- Import/export uses `chessops/pgn` RAV trees (ADR-028): flatten a variation
  tree into the DAG on import; walk the DAG back into a canonical mainline plus
  variations on export.

Persistence is a new additive Dexie schema version (v14, after Feature 020's
v13), following the existing migration and ownership-cascade pattern.

## Scope sketch

### In scope

- Domain model for repertoires, positions, moves/edges, side selection.
- Canonical position key (EPD normalization, en-passant legality, castling
  rights; Chess960 castling rights part of the key).
- Transposition de-duplication on build/import.
- PGN import (RAV flatten, comments/NAGs preserved where practical) and export
  (canonical mainline + variations).
- Storage: `repertoires`, position-keyed nodes, edges, and optional line
  snapshots; repositories; game/puzzle-independent deletion cascade.
- Pure domain tests with deterministic fixtures (transpositions, move order,
  en-passant, castling).

### Out of scope

- Creator UI (Feature 023), opening identification (022), training (024),
  coverage (025), compliance (026).
- Engine evaluation of repertoire moves.
- Sync wiring (deferred until the spec is finalized; then ADR-016/017).

## Dependencies

- Feature 003 — chess domain, `chessops`.
- ADR-028 — chess rules/state/PGN via `chessops`.
- ADR-030 — `chessops/pgn` usage precedent.

## Open questions

1. Exact table shape: one `nodes` table keyed `[repertoireId, positionKey]` plus
   an `edges` table, vs storing the graph as a document.
2. Whether line snapshots are stored (import/export fidelity) or always derived.
3. Multiple repertoires per side; repertoire metadata (name, color, source).
4. How much PGN metadata (comments, NAGs, glyphs) to preserve through the
   DAG round-trip.
5. Chess960 in V1 or standard chess only (key must still include castling
   rights).
6. Whether repertoire content participates in the ADR-016 sync envelope.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §7 storage)
- `.opencode/specs/features/003-chess-domain.md`
- `.opencode/specs/domain/game-model.md`
- `.opencode/specs/decisions/ADR-028-chessops.md`
- `.opencode/specs/decisions/ADR-030-drop-pgn-viewer.md`
- `.opencode/specs/research/opening-repertoire.md`
