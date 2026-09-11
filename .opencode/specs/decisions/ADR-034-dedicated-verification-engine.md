# ADR-034: Dedicated Tactical-Verification Engine & Global Thread Budget

## Status

Accepted

## Decision

ChessRemedy runs **two independent Stockfish engine instances**, each in its
own Web Worker with its own FIFO job queue:

- the **analysis engine** — the shared Feature-005 service used by Live
  Analysis (Feature 006) and full-game analysis (Feature 008);
- the **verification engine** — a dedicated instance used only by the
  Feature-010 Stage-2 tactical verification pass (ADR-026).

Both instances share the same engine build/capability selection (ADR-012) and
the same persistent ADR-018 position-keyed cache, but never a worker,
transport, or job queue. Feature 010 receives the verification instance
through its existing injectable `engine: EngineService` seam, so detection no
longer interleaves with game analysis on the shared FIFO.

### Why a second worker

A single worker + FIFO makes a detection pass and the next game's analysis
serialize (head-of-line blocking): analysis of game N+1 cannot start until
game N's tactical verification finishes. On a multi-core device the two
workloads are independent and should overlap. Tactical verification is
derived, latency-tolerant work; game analysis and live analysis are the
interactive path and must not wait behind it.

### Thread budget (the global rule)

Let `B` be the **global engine thread budget**:

```
canMultiThread = crossOriginIsolated && sharedArrayBuffer && hardwareConcurrency > 1
B = canMultiThread ? max(1, min(hardwareConcurrency, MAX_THREADS_CAP)) : 1
```

with `MAX_THREADS_CAP = 8` (ADR-012). The two engines partition `B` and must
**never both run at the maximum**:

- verification engine: `tV = VERIFICATION_THREADS = 1` (fixed default,
  conservative; not user-facing in V1);
- analysis engine: `tA = clamp(userRequested, 1, max(1, B - tV))`.

Invariant on the multi-threaded build: `tA + tV <= B`. On an 8-core device
that is analysis ≤ 7 plus verification 1; on a 2-core device it is analysis 1
plus verification 1. On the single-threaded build (`canMultiThread = false`)
both engines run the single-threaded `lite-single` build and each uses exactly
1 search thread; the arithmetic budget does not apply and the OS schedules the
two single-threaded workers.

### Lifecycle

The verification engine follows the Feature-005 lifecycle
(`uninitialized → initializing → ready → busy → ready → disposed`) and is:

- **created lazily** on the first Stage-2 verification job, so a user who
  never runs detection never pays for a second WASM instance;
- **reused** across candidates and passes within a session;
- **disposed on idle** after `VERIFICATION_ENGINE_IDLE_MS` with no active or
  queued verification job, releasing the WASM/heap memory; the next
  verification job re-creates it;
- **disposed explicitly** with the analysis-service teardown.

### Memory

Two instances mean two WASM heaps and two hash tables. Each instance's hash is
clamped by the ADR-012 capability cap (64 MB mobile / 256 MB desktop), and the
`tactical` profile requests 128 MB, so a concurrent desktop pair is up to
~192 MB of hash (analysis `normal` 64 MB + verification `tactical` 128 MB)
plus WASM overhead; on mobile the cap brings it to at most 2 × 64 MB. Lazy
creation and idle disposal bound the second instance to the windows where
detection is actually running.

## Reasons

- Detection and analysis are independent workloads; overlapping them removes
  the head-of-line blocking the single FIFO imposes without changing either
  pipeline.
- The injectable `EngineService` seam already exists (ADR-009 consequence: the
  engine service is separate from the worker bootstrap and unit-testable
  against a fake transport), so the second instance is an assembly change, not
  a new engine implementation.
- A fixed 1-thread verification engine plus a reserved budget keeps the device
  responsive and prevents the two engines from oversubscribing the CPU.

## Consequences

- The browser assembly constructs two engine services and hands the
  verification one to `TacticalDetectionService`; both read/write the same
  ADR-018 cache, so a position verified by either engine is reusable by the
  other. The cache scope includes the effective depth and threads, so the two
  instances never share entries by accident (ADR-018).
- Each engine service keeps its own queue watchdog (`queuedTimeoutMs`) and
  stall watchdog; a wedged verification worker can never hold the analysis
  queue open, and vice versa.
- The Feature-010 engine-activity UI reads the detection service's session
  registry, not the analysis engine's queue, for scan state; the Library
  banner reports both activities.
- `MAX_THREADS_CAP = 8` is the per-engine ceiling (ADR-012). The analysis
  engine's user-selectable cap is `max(1, B - 1)` on the multi-threaded build
  because 1 thread is reserved for verification.
- The Feature-008 Game-analysis threads override applies to the **analysis**
  engine only; the detection pass uses the verification engine's own
  conservative thread count. This supersedes the Feature-008 §3 sentence that
  the override also applies to tactical scans.

## Sources

- `specs/ARCHITECTURE.md` §5
- `specs/features/005-stockfish.md` §1/§13/§15/§20
- `specs/features/010-tactical-detection.md`
- `specs/decisions/ADR-004` (local Web Workers)
- `specs/decisions/ADR-009` (injectable transport / testability)
- `specs/decisions/ADR-012` (build/profile/hash/thread cap)
- `specs/decisions/ADR-018` (position-keyed cache)
- `specs/decisions/ADR-026` (tactical verification pipeline)
