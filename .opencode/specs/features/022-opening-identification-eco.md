# Feature 022 — Opening Identification & ECO Library

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation. The opening-data/licensing ADR will be written
> when the spec is finalized.

## Goal

Name openings offline: given a position (or a line), resolve its ECO code and
opening name, and show names throughout the repertoire UI. This must work with
no network and no dependency on the Lichess Explorer.

## Idea

Vendor the **`lichess-org/chess-openings`** dataset (CC0-1.0, ~3,815 named
lines across a–e, fields `eco`/`name`/`pgn` plus generated `uci`/`epd`) and
classify positions by playing moves backwards to a named position, exactly as
the dataset's own conventions describe. Because transpositions exist, a lookup
returns the matching named line(s); the UI shows the shortest/most common name.

The dataset is a build-time asset (bundled, versioned) so opening names are
available offline; updates are a dataset bump, not a runtime fetch.

## Scope sketch

### In scope

- Vendoring and parsing `lichess-org/chess-openings` into a lookup structure
  keyed by position.
- A pure classifier: position/line → ECO + name (transposition-aware).
- Display of opening names in repertoire nodes, lines and (later) the trainer.
- A dataset version recorded for reproducibility (ARCHITECTURE §9 style).

### Out of scope

- Move statistics, win rates, popularity (Feature 025).
- Any network fetch (the Explorer is auth-gated; see Feature 025).
- Editing/naming user-defined openings beyond a future annotation field.

## Dependencies

- Feature 021 — repertoire positions/lines to name.
- ADR-028 — `chessops` FEN/EPD and move application.

## Open questions

1. Bundle the dataset as a build asset (JSON/TSV) vs import it into Dexie on
   first run.
2. Classification ambiguity policy when several named lines match a position.
3. Whether user-defined repertoire names override the ECO name in the UI.
4. Dataset update/versioning process and how stale names are handled.
5. Data size/bundle impact and lazy-loading strategy.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/features/021-opening-repertoire-domain.md`
- `.opencode/specs/decisions/ADR-028-chessops.md`
- `.opencode/specs/research/opening-repertoire.md` (free databases / licenses)
