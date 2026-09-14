# Feature 024 — Opening Trainer

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation.

## Goal

Train the user's repertoire with spaced repetition: at each position the user
must play **their** repertoire move; the scheduler decides when a position
comes back.

## Idea

The trainer is the opening-side consumer of the `Scheduler` introduced in
Feature 020, with the **card key being a repertoire position/edge** instead of a
puzzle id. Review state is shared across transpositions automatically, because
the key is the position (Feature 021).

Flow: a training session walks the repertoire (or a selected subset), presents
only the user's moves, accepts the played move on the board, and grades it
(correct/incorrect, latency, hints). Attempts are recorded immutably, exactly
like puzzle attempts, so a future algorithm change can replay them.

## Scope sketch

### In scope

- A repertoire training session: prompt at a position, user plays a move.
- Grading and feedback (correct / wrong / hint / reveal).
- Scheduling via the Feature-020 `Scheduler`; due-position queue and new intake.
- Per-repertoire and per-side session scoping (train White, Black, or a branch).
- Reuse of the Chessground board and the Feature-019 session shell.
- Transposition-shared review state.

### Out of scope

- Coverage/gap detection (025) and compliance over real games (026).
- Model games / guess-the-move (028).
- Editing the repertoire from inside a session (Feature 023).

## Dependencies

- Feature 020 — `Scheduler` interface and scheduling model.
- Feature 021 — repertoire DAG and position keys.
- Feature 023 — the repertoire to train.
- Feature 019 — session host (setup/begin/solve/summary).
- ADR-031 — amended for the individual strategy.

## Open questions

1. Attempt/event storage for openings: reuse `puzzleAttempts` with an opening
   key, or a dedicated opening-attempts table.
2. Session scoping and ordering (line order vs due order vs mixed).
3. Grading semantics for legal-but-non-repertoire moves and for "no reply
   defined" gaps (ties into Feature 025).
4. Whether the opponent's replies are auto-played from the repertoire or the
   user also trains recognition of opponent moves.
5. How much of the Feature-019 session shell is reused vs a dedicated trainer
   shell.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §7 storage, §12 future extensions)
- `.opencode/specs/features/019-timed-training-sessions.md`
- `.opencode/specs/features/020-individual-review-scheduling.md`
- `.opencode/specs/features/021-opening-repertoire-domain.md`
- `.opencode/specs/features/023-repertoire-creator-ui.md`
- `.opencode/specs/decisions/ADR-031-tactical-training-cycles.md`
- `.opencode/specs/research/opening-repertoire.md`
