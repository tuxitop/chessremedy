# ADR-033: Unified Analysis Board (stored review + live analysis)

## Status

Accepted

## Decision

ChessRemedy has a single, shared **analysis-board** surface used by Game
Review (Feature 008), the Live Analysis board (Feature 006), and later
puzzle playback (Feature 012). It composes the shared Chessground-10.1.1
board wrapper, an evaluation bar, the chessops move list, an engine-lines
panel, board arrows, and analysis controls.

The surface runs in two distinct modes over the same component:

1. **Stored review** — reads only persisted `MoveAnalysis` records
   (evaluation bar, per-move evaluations, engine lines/MultiPV, best-move
   arrows, classifications). No engine is started to render stored
   positions (ADR-004); the FEN-keyed engine cache (ADR-018) and stored
   records are the only data sources.
2. **Live analysis** — runs the Feature-005 Stockfish service against the
   currently selected position. It is explicitly labeled live, is
   cancellable, shows engine status/progress, and **never writes into
   persisted `MoveAnalysis`**. Persisting live results only happens through
   an explicit analysis/re-analysis run, which creates a new analysis
   identity (ADR-019/020, ARCHITECTURE.md §9).

Exploration is non-destructive: previewing an engine continuation ("best
line", a PV move, a mistake's recommended move) plays an ephemeral overlay
that never mutates the stored `Game`/PGN or the analysis tree.

## Reasons

- Both Lichess and Chess.com reuse one board core across analysis/review;
  ChessRemedy's Live Analysis (006) and Review (008) today duplicate layout
  and state instead of sharing it.
- Stored review and live analysis are the same conceptual surface with a
  different data source; one component keeps behavior, keyboard shortcuts,
  accessibility, and responsive layouts consistent and gives later
  features (puzzles) a ready-made playback surface.
- Separating "live" from "persisted" prevents the classic failure mode of a
  review tool silently replacing stable stored evaluations with a transient
  live eval (which Chess.com documents as user-facing confusion).

## Consequences

- Review and Live Analysis share a single layout/state model and one
  app-wide keyboard table; keyboard shortcuts are never the only way to
  perform an essential action (buttons remain).
- Review reads persisted `MoveAnalysis` only; evals/lines/arrows shown in
  stored mode come from the stored analysis (profile/engine/version shown in
  an identity chip) and are never recomputed in the view.
- Live mode results update eval bar/engine lines/arrows while thinking and
  may be stored only through an explicit, versioned analysis run.
- Evaluation semantics are unified: the eval bar and per-move values show the
  evaluation **after** the selected move; classifications come from the
  canonical domain classifier (ADR-023) and are never recomputed in the UI.
- Best-move/PV arrows use Chessground auto-shapes and are toggleable; arrows
  are never shown when the user has disabled engine suggestions.

## Sources

- `specs/ARCHITECTURE.md` §5/§6
- `specs/features/006-live-analysis-board.md`
- `specs/features/008-game-analysis.md`
- ADR-002, ADR-004, ADR-014, ADR-018, ADR-019, ADR-020, ADR-023
- Research: Lichess analysis board (`ui/analyse`), Chess.com Game Review /
  Self Analysis, ChessBase analysis windows
