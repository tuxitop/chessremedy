# Feature 025 — Opening Coverage & Gap Detection

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation. The opening-data/licensing ADR (shared with
> Feature 022) covers the optional Lichess Explorer dependency.

## Goal

Show how much of the likely opponent play the repertoire covers, and surface
the biggest **gaps** — the most probable opponent moves the user has no
response to — so the user can prioritise what to add.

## Idea

Coverage is a property of the repertoire DAG: a position is "covered" when the
side-to-move user has at least one edge for it. A **gap** is a position where
the user must move but has no edge, weighted by how likely the opponent is to
reach it.

Two sources, in priority order:

1. **Offline (always available):** derive opponent-move frequencies from the
   user's own imported games (Features 007/008) — local-first, no network.
2. **Online (optional):** the Lichess Opening Explorer for broader statistics.
   The Explorer now requires **OAuth2** (since 2026-03-03), is rate-limited to
   25 req/min, and caps depth at 50 plies; results must be cached locally and
   the feature must degrade gracefully offline.

Chess.com is not a source: its published API exposes no opening statistics and
carries brand/IP restrictions.

## Scope sketch

### In scope

- Coverage computation over the repertoire DAG (covered / uncovered positions).
- Gap ranking using local game-derived frequency by default.
- Optional Lichess Explorer integration (OAuth2 PKCE, rate-limit + cache,
  offline fallback).
- A "gaps" view that links into the creator (023) to add a response.

### Out of scope

- Repertoire compliance over specific games (026).
- Engine evaluation of candidate responses.
- Any Chess.com opening statistics.

## Dependencies

- Feature 022 — opening names/ECO for labelling.
- Feature 024 — training state for "known vs due" prioritisation.
- Feature 007 / 008 — imported games and analysis for local frequencies.
- Lichess OAuth2 PKCE (reuse the import auth path in `research/game-import.md`).

## Open questions

1. Coverage definition: per position, per opening line, or a weighted aggregate.
2. Local-frequency model (rating band, recency, time control) without a server.
3. Explorer auth: reuse the existing Lichess token vs a separate consent.
4. Cache key/TTL for explorer responses and how to keep them out of sync.
5. How gaps are ranked and how many to surface by default.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/features/007-game-import.md`
- `.opencode/specs/features/021-opening-repertoire-domain.md`
- `.opencode/specs/features/022-opening-identification-eco.md`
- `.opencode/specs/features/024-opening-trainer.md`
- `.opencode/specs/decisions/ADR-001-local-first.md`
- `.opencode/specs/research/opening-repertoire.md` (Explorer auth, CC0 data)
- `.opencode/specs/research/game-import.md` (Lichess OAuth2 PKCE)
