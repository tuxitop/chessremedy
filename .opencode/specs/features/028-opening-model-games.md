# Feature 028 — Opening Model Games (Guess the Move)

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation. This feature is optional and may be deferred
> or dropped.

## Goal

Reinforce opening plans by playing through master games in the user's openings
and guessing the next move — the "model games / guess-the-move" idea seen in
commercial opening trainers.

## Idea

Given a repertoire position (Feature 021), surface model games that reach it
(from the Lichess open database / masters data, or the user's own games) and
let the user play through them, guessing the side's moves with feedback. It is a
training variant that reuses the board (Chessground), the shared analysis board
(ADR-033) and the move list (ADR-030); it is not a new game source.

## Scope sketch

### In scope

- Selecting model games for a repertoire line/position.
- A guess-the-move walkthrough with feedback and optional evaluation.
- Reuse of the board, move list and navigation conventions.

### Out of scope

- New providers or a new game database integration beyond what exists.
- Opening statistics (025) and compliance (026).
- Engine-heavy analysis of model games (keep it lightweight; reuse the engine
  service only if needed and only off the UI thread, ADR-004).

## Dependencies

- Feature 021 — repertoire positions/lines.
- Feature 024 — training shell and board reuse.
- Lichess open database (CC0) or the user's imported games as the model-game
  source.

## Open questions

1. Model-game source: Lichess open database vs the user's own games vs both.
2. Whether evaluation/feedback is engine-backed or result-based only.
3. How model games are matched to repertoire positions (depth/transposition).
4. Whether progress here is scheduled (ties into Feature 020) or informal.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/features/021-opening-repertoire-domain.md`
- `.opencode/specs/features/024-opening-trainer.md`
- `.opencode/specs/decisions/ADR-004-stockfish.md`
- `.opencode/specs/decisions/ADR-033-unified-analysis-board.md`
- `.opencode/specs/research/opening-repertoire.md`
