# Analysis Domain Model

Canonical analysis model for ChessRemedy. Feature 008 (Game Analysis)
produces and persists `MoveAnalysis` records; Features 009/010/011/014
consume them. The model is shared — no feature-specific duplicate.

## Game-scoped vs engine cache

Two distinct stores (see ARCHITECTURE.md §7, ADR-018):

1. **Game-scoped analysis** — the authoritative persisted `MoveAnalysis`
   records and analysis metadata/jobs for a game. Deleting the game
   deletes these.
2. **FEN/position-keyed engine cache** — raw engine responses keyed by
   position FEN (ADR-018). Positions are shared across games and the
   cache is an independent performance store. Game deletion never
   purges it.

## MoveAnalysis

One record per analyzed ply of a game. Each record:

- `analysisId` — identity of the analysis run that produced it
  (see Analysis identity).
- `gameId`
- `ply` (0-based from the game's start position) and `moveNumber`
- `side` (the mover)
- `playedMove` (SAN/UCI)
- `positionFen` (position before the move)
- `evalBefore` / `evalAfter` (cp and/or mate; nullable)
- `wdlBefore` / `wdlAfter` (per-mille, nullable — `fast` profile has no
  WDL, ADR-019)
- `bestMove` and `bestPv` (principal variation after the move)
- MultiPV lines when required by the selected profile; each retained line
  carries its evaluation, WDL and the engine search **depth** reached
  (or equivalent quality metadata) when the engine reported it
- `legalMovesCount`
- `inBook` (book/opening move tagging)
- Optional per-move clock data (`clockAfterMs`) when the imported PGN
  carried `[%clk …]` annotations — the mover's remaining time after the
  move. Clock annotations are parsed structurally (`domain/clock.md`) and
  are never rendered as ordinary comments. Absent clocks are omitted, not
  fabricated. Time spent per move is always *derived* (from consecutive
  same-color clocks plus the increment) and is not stored as a measured
  value.
- `classification` (`best`/`good`/`inaccuracy`/`mistake`/`blunder`)
  plus `classificationVersion` — canonical rules in
  `domain/classification.md` (ADR-023)
- `gamePhase` (`opening`/`middlegame`/`endgame`) — canonical rule in
  `domain/game-phase.md`
- Reserved missed-tactic contract: `missedTactic: boolean` (default
  false) and `detectionVersion` (null until set). Set by Feature 010;
  never computed by Feature 008.
- Engine metadata: `engineName`, `engineVersion`, `engineBuild`,
  `profile`
- Record timestamps

Stored review (ADR-033) reads only these persisted records — the
evaluation bar, per-move evaluations, engine lines and best-move arrows in
Review come from `MoveAnalysis` and are never recomputed in the view. Live
analysis results are never written into persisted records except through an
explicit analysis/re-analysis run with a new identity.

## Analysis identity

An analysis run is identified by its configuration so two analyses of
the same game are distinguishable:

- `analysisVersion`
- engine name / version / build
- profile (ADR-012)
- relevant engine configuration (depth/movetime/hash/threads/multipv)
- classification version and game-phase version in effect
- creation / completion timestamps

An existing analysis is never silently treated as equivalent to a newly
requested analysis with a different identity (ADR-020/§9 versioning).

## Analysis job states

Persistent per-game jobs (Feature 008 queue):

- `queued`
- `inProgress`
- `completed`
- `cancelled`
- `failed`

A game is only "completed" when every required position has a persisted
`MoveAnalysis` record for the requested analysis identity. Completed
records survive job cancellation/restart and interrupted work resumes
without repeating completed positions.

## Required concepts (position context)

A record's inputs must be reconstructible from the game for analysis:
position before the move, move played, side to move, resulting position,
and engine evaluation before/after with preferred continuation.
