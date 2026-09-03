# Feature 005 — Stockfish Engine Integration

## Goal

Run Stockfish locally in the browser without blocking the UI and provide a reliable, cancellable engine-analysis service that later features can use for game analysis, move classification, tactical detection, and puzzle generation.

This feature establishes the Stockfish execution layer only. It does not classify moves, detect blunders, analyze complete games, or generate puzzles.

---

## Scope

This feature provides:

* Stockfish WASM integration
* Web Worker execution
* engine lifecycle management
* a typed engine service API
* analysis job queue
* job cancellation
* progress updates
* failure and timeout handling
* configurable analysis profiles
* engine/version metadata
* deterministic test positions
* a Stockfish development playground

The implementation must keep Stockfish-specific concerns isolated from the chess domain and UI.

---

## Non-Goals

The following are explicitly outside this feature:

* importing games from Chess.com or Lichess
* analyzing complete games
* move classification
* blunder/mistake/inaccuracy classification
* missed-tactic detection
* tactical motif classification
* puzzle generation
* tactical-training cycle bookkeeping
* dashboard statistics
* player accuracy calculation

Later features consume the engine service created here.

---

# 1. Engine Architecture

Stockfish MUST run entirely inside a Web Worker.

The React/UI thread must never execute the Stockfish search directly.

```text
UI
 │
 │ analysis request
 ▼
Engine Service
 │
 ▼
Job Queue
 │
 ▼
Web Worker
 │
 ▼
Stockfish WASM
 │
 │ UCI messages
 ▼
Web Worker
 │
 ▼
Engine Service
 │
 ├── progress
 ├── result
 └── error
 ▼
UI
```

The engine service must hide Worker and UCI implementation details from callers.

Consumers should interact with a typed application-level API rather than sending raw UCI commands.

---

# 2. Stockfish WASM

Use a browser-compatible Stockfish WASM build suitable for running inside a Web Worker.

The exact Stockfish build, package, version, licensing, and hosting
approach are defined by ADR-012 (Stockfish WASM Build) and the
Dependency policy in `AGENTS.md`.

The selected engine version must be recorded in application metadata and in every analysis result.

The implementation must not assume that a particular Stockfish distribution can be replaced without checking its Worker/WASM interface and licensing.

---

# 3. Engine Service

Provide a single application-level service responsible for engine interaction.

The service should expose operations equivalent to:

```ts
interface EngineService {
  analyze(
    position: EnginePosition,
    options?: AnalysisOptions
  ): AnalysisJob;

  cancel(jobId: string): void;

  cancelAll(): void;

  getStatus(): EngineStatus;

  dispose(): Promise<void>;
}
```

The exact API may differ during implementation, but these responsibilities must remain available.

The service must:

* validate requests before submitting them to the Worker;
* assign unique job IDs;
* queue analysis jobs;
* dispatch jobs to the Worker;
* expose progress;
* return completed results;
* support cancellation;
* recover from Worker/engine failure;
* expose engine metadata.

The service must not own the application's chess game state.

---

# 4. Position Input

Analysis must operate on a chess position rather than requiring a complete game.

The primary position representation should be FEN.

A position must contain sufficient information to reproduce the exact chess state, including:

* piece placement;
* side to move;
* castling rights;
* en-passant target;
* halfmove clock where relevant;
* fullmove number where relevant.

The service must reject invalid positions before sending them to Stockfish.

The chess domain remains responsible for authoritative chess-state validation; the engine layer must not become a second chess rules implementation.

---

# 5. Analysis Jobs

Every analysis request creates a job with a unique ID.

A job has a lifecycle similar to:

```text
queued
  ↓
running
  ↓
completed

queued/running
  ↓
cancelled

queued/running
  ↓
failed
```

A job must never silently disappear.

The caller must be able to distinguish:

* completed analysis;
* cancellation;
* engine failure;
* invalid request;
* timeout/resource failure.

Only one analysis job should be actively searched by a single Stockfish Worker unless the selected engine architecture explicitly supports safe parallel execution.

Queued jobs must execute in deterministic order unless a later priority mechanism is explicitly introduced.

---

# 6. Job Queue

The engine service must maintain an internal queue.

The queue must:

* accept multiple analysis requests;
* process jobs in FIFO order by default;
* expose job status;
* allow queued jobs to be cancelled;
* prevent abandoned jobs from remaining indefinitely;
* continue processing subsequent jobs after a successful job;
* recover appropriately after a failed job.

The queue implementation must be independent of React components.

---

# 7. Cancellation

Analysis must be cancellable.

Cancellation must work for both:

* jobs that are still queued;
* jobs currently being analyzed.

Cancelling an active job must stop the Stockfish search and return the Worker to a usable idle state.

If the Worker cannot be safely returned to a known state, the service may terminate and recreate the Worker.

A cancelled job must never be reported as successfully completed.

---

# 8. Progress

Running jobs must provide progress information whenever Stockfish provides it.

Progress should support information such as:

* current depth;
* selective depth where available;
* nodes;
* nodes per second;
* hash usage where available;
* elapsed time;
* current principal variation;
* current evaluation.

Progress is informational and must not be treated as a percentage unless a reliable percentage can be calculated.

The UI must therefore be able to display:

```text
Depth: 18
Nodes: 1.4M
Time: 2.1s
Evaluation: +0.72
PV: Nf3 d5 g3 ...
```

rather than displaying misleading progress such as `72% complete`.

---

# 9. Analysis Result

A completed analysis result must contain enough information for future game-analysis features.

At minimum:

```ts
interface EngineAnalysisResult {
  jobId: string;
  position: string;        // FEN
  evaluation: EngineEvaluation;
  principalVariation: EngineMove[];
  depth?: number;
  selectiveDepth?: number;
  nodes?: number;
  timeMs: number;
  engine: EngineMetadata;
}
```

The exact model may be expanded during implementation.

The result must identify:

* analyzed position;
* evaluation;
* principal variation;
* analysis depth and/or search limit;
* elapsed analysis time;
* engine name;
* engine version;
* relevant engine configuration/profile.

Future features must therefore be able to determine exactly which engine configuration produced an analysis.

---

# 10. Evaluation

The engine layer must preserve the distinction between:

* centipawn evaluation;
* mate evaluation.

For example:

```text
+0.82
-1.34
M3
-M5
```

Mate scores must not be incorrectly converted into ordinary centipawn values.

The result model must preserve the side from which the evaluation is expressed.

Evaluation normalization required for comparing a player's move with the engine's recommendation should be handled by the later game-analysis/classification layer, not by this feature.

---

# 11. MultiPV

The engine integration should support MultiPV if supported by the selected Stockfish build.

The analysis options should therefore be capable of requesting:

```text
MultiPV = 1
MultiPV = 2
MultiPV = 3
...
```

The default profile should use the minimum MultiPV necessary for its purpose.

MultiPV results must preserve the ordering/rank of the engine lines.

The engine service must not assume that MultiPV is always enabled.

---

# 12. Analysis Profiles

The engine service must provide named analysis profiles.

Initial profiles:

> Profile names: ADR-012 defines the canonical V1 profile set
> `fast` / `normal` / `tactical` / `deep`. The three profiles below
> correspond to `fast`, `deep`, and `tactical`; the `normal` profile
> (ADR-012) is the default used by Feature 006 and Feature 008.
> The exact numerical parameters for each profile are defined in
> ADR-012 and must be tested.

### Fast

Designed for responsive interactive analysis.

Typical use:

* puzzle feedback;
* quick position inspection;
* interactive UI.

The exact depth/time/node limits are defined by the engine configuration ADR or implementation decision.

### Deep

Designed for higher-confidence analysis.

Typical use:

* game analysis;
* dashboard data generation;
* deeper investigation.

It may use greater search time/depth and resources than `fast`.

### Tactical Verification

Designed to verify tactical positions and candidate solutions.

Typical use:

* validating candidate puzzle positions;
* checking tactical sequences;
* confirming whether a tactical opportunity is real.

This profile may use stronger search limits and/or MultiPV.

The exact numerical parameters for each profile must be documented and tested.

Profiles must be configuration data rather than duplicated engine-control logic.

---

# 13. Resource Configuration

The engine configuration should support, where provided by the selected Stockfish build:

* threads;
* hash size;
* MultiPV;
* depth limit;
* time limit;
* node limit;
* other relevant UCI options.

Browser resource limits must be respected.

The application must not blindly allocate all available CPU or memory.

Default settings should favor usability on ordinary desktop and mobile devices.

User-facing engine customization will be introduced through a future
settings surface (no Settings feature exists in the V1 roadmap); this
feature only establishes the configuration mechanism.

---

# 14. Failure Handling

The engine service must handle:

* WASM initialization failure;
* Worker creation failure;
* Stockfish initialization failure;
* malformed engine responses;
* Worker termination;
* unexpected Worker errors;
* analysis timeout;
* invalid position;
* cancellation;
* unsupported engine options.

Failures must produce structured errors that can be handled by the UI.

A single failed job must not permanently break the engine service where recovery is possible.

If recovery requires restarting the Worker, queued jobs must either be preserved or explicitly failed according to the documented policy.

---

# 15. Worker Lifecycle

The service must support:

```text
uninitialized
     ↓
initializing
     ↓
ready
     ↓
busy
     ↓
ready
```

and failure/disposal states.

The Worker must not be created repeatedly for every analysis request unless required by the selected implementation.

The service must provide explicit disposal so that the application can release the Worker when it is no longer needed.

---

# 16. Deterministic Test Fixtures

Feature 005 must introduce a small set of deterministic chess positions specifically for engine verification.

Fixtures should include positions where the expected engine behavior is unambiguous, such as:

* obvious mate;
* forced mate;
* winning material;
* clearly advantageous move;
* quiet position requiring deeper search.

The fixtures must be independent of imported user games.

Tests should verify engine characteristics rather than rely excessively on one exact evaluation number, because evaluation can vary between engine versions, builds, and configurations.

Where exact engine output is required, the test must pin the engine version and configuration.

---

# 17. Stockfish Playground

Provide a development-only Stockfish playground using the existing Chessground playground.

The playground must allow the developer to:

* select a predefined position;
* display the position on Chessground;
* start analysis;
* stop analysis;
* select an analysis profile;
* display engine status;
* display analysis progress;
* display evaluation;
* display depth;
* display principal variation;
* display engine/version metadata;
* observe engine errors.

The playground must remain responsive while Stockfish is analyzing.

It must be possible to interact with the chessboard while an analysis is running.

The playground must not require:

* imported games;
* a database;
* Chess.com;
* Lichess;
* puzzle generation.

---

# 18. Chessground Integration

The Stockfish playground must use the existing Chessground integration.

Chessground remains responsible for board presentation and interaction.

Stockfish must receive the position from the chess domain/application layer rather than reading internal Chessground state.

The integration must therefore follow:

```text
Chess Domain
     ↓
FEN
     ↓
Engine Service
     ↓
Stockfish
     ↓
Engine Result
     ↓
UI
```

not:

```text
Chessground
     ↓
Stockfish
```

---

# 19. Testing Requirements

At minimum, automated tests must cover:

### Engine service

* service initialization;
* successful engine startup;
* analysis request;
* result delivery;
* job IDs;
* queue ordering;
* queued-job cancellation;
* active-job cancellation;
* multiple sequential jobs;
* failure recovery;
* disposal.

### Worker

* Worker creation;
* Worker communication;
* Stockfish initialization;
* UCI command handling;
* engine result parsing;
* error handling.

### Analysis

* valid FEN analysis;
* invalid FEN rejection;
* evaluation parsing;
* mate score parsing;
* principal variation parsing;
* metadata preservation;
* MultiPV parsing where enabled.

### Profiles

* all profiles produce valid configuration;
* profile configuration is deterministic;
* profile settings are correctly passed to the engine.

### UI

* playground can start analysis;
* progress is displayed;
* cancellation works;
* engine failure is displayed;
* UI remains responsive during analysis.

Tests must not depend on real Chess.com/Lichess data.

---

# 20. Performance Requirements

Stockfish computation must not execute on the main UI thread.

The application should remain responsive while a normal analysis is running.

The implementation should avoid unnecessary copying of large messages between the UI thread and Worker.

Worker communication should be asynchronous.

Performance targets should be established using representative desktop and mobile environments rather than assuming desktop hardware.

---

# 21. Security and Privacy

All Stockfish analysis performed by this feature is local.

No chess positions or analysis data should be sent to a remote chess engine or external analysis service.

The engine Worker must not require network access during normal analysis after the required WASM assets have been installed/loaded.

---

# 22. Acceptance Criteria

### Core

* [ ] Stockfish runs locally in a Web Worker.
* [ ] A valid FEN position can be analyzed.
* [ ] Analysis does not block the UI.
* [ ] A completed result contains evaluation and principal variation.
* [ ] A completed result contains engine name/version metadata.
* [ ] A completed result identifies the analysis configuration/profile.

### Jobs

* [ ] Multiple analysis jobs can be queued.
* [ ] Jobs have unique IDs.
* [ ] Queued jobs can be cancelled.
* [ ] Active analysis can be cancelled.
* [ ] A cancelled job is never reported as completed.
* [ ] The engine remains usable after cancellation.

### Progress

* [ ] Analysis progress can be observed.
* [ ] Depth/time/nodes/PV information is exposed when available.
* [ ] The UI does not display misleading percentage completion.

### Profiles

* [ ] `fast` profile exists.
* [ ] `normal` profile exists (ADR-012 default).
* [ ] `deep` profile exists.
* [ ] `tactical-verification` / `tactical` profile exists.
* [ ] Profiles produce deterministic engine configurations.

### Failure handling

* [ ] Invalid positions are rejected.
* [ ] Worker failures are detected.
* [ ] Engine initialization failures are reported.
* [ ] Malformed engine responses do not crash the application.
* [ ] Analysis can recover from a recoverable Worker/engine failure.

### Playground

* [ ] A Stockfish playground exists.
* [ ] Predefined positions can be analyzed.
* [ ] Analysis can be started and stopped.
* [ ] Engine progress and result are visible.
* [ ] Engine/version metadata is visible.
* [ ] The board remains responsive during analysis.
* [ ] The playground works without imported games.

### Verification

* [ ] Unit/integration tests pass.
* [ ] Production build passes.
* [ ] Stockfish Worker tests pass.
* [ ] The deterministic engine fixtures pass.
* [ ] No external chess API is required.
* [ ] No real user games are required.

---

## Context

### Required reading

- `ARCHITECTURE.md` §2 (Technology), §5 (Engine)
- `decisions/ADR-004`, `decisions/ADR-012`, `decisions/ADR-018`,
  `decisions/ADR-020`, `decisions/ADR-009`, `decisions/ADR-027`
- `domain/analysis-model.md`
- `research/browser-stockfish.md`

### Required (features)

* Feature 001 — Foundation
* Feature 002 — Chessboard
* Feature 003 — Chess Domain

### Not Required

* Game persistence
* Chess.com integration
* Lichess integration
* Game analysis
* Move classification
* Puzzle generation

---

## Outputs

Feature 005 produces:

1. Stockfish WASM integration.
2. Stockfish Web Worker.
3. Typed engine service.
4. Analysis job queue.
5. Cancellation mechanism.
6. Progress/result/error models.
7. Named analysis profiles (fast/normal/tactical/deep per ADR-012).
8. Engine metadata model.
9. Deterministic engine test fixtures.
10. Automated tests.
11. Stockfish development playground.

These outputs become infrastructure for subsequent game-analysis and tactical-training features.
