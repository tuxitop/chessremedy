# FSRS TypeScript Implementation Selection

## Question

Which TypeScript/JavaScript FSRS implementation should ChessRemedy use for V1
puzzle scheduling in a local-first React + Vite SPA backed by IndexedDB/Dexie?

## Sources

- npm package pages: `ts-fsrs`, `@squeakyrobot/fsrs`, `fsrs-browser`
- GitHub repositories: open-spaced-repetition/ts-fsrs, SqueakyRobot/fsrs,
  open-spaced-repetition/fsrs-browser
- awesome-fsrs implementations list
- npm download counts and package metadata
- Package.json files for each candidate
- Bundlephobia / npm.io size data

## Findings

### Candidate 1: `ts-fsrs`

| Attribute | Value |
|---|---|
| **npm package** | `ts-fsrs` |
| **Latest stable version** | 5.4.1 |
| **Published** | June 2026 (~2 months ago) |
| **GitHub stars** | 769 |
| **License** | MIT |
| **npm weekly downloads** | 93,036 |
| **Runtime dependencies** | 0 |
| **Node.js requirement** | >=20.0.0 (build tooling; pure TS output) |
| **FSRS algorithm version** | v6 (latest) |
| **Module formats** | ESM, CommonJS, UMD |
| **TypeScript declarations** | Built-in (bundled .d.ts) |
| **Maintainer** | ishiko732 (active, open-spaced-repetition org) |
| **GitHub commits** | 283 |
| **Open issues** | 2 |
| **Browser example** | Yes (`example/example.html`) |

**API surface:**

- `fsrs(params?)` — create scheduler instance
- `createEmptyCard(now?)` — new card
- `scheduler.repeat(card, now)` — preview all 4 rating outcomes
- `scheduler.next(card, now, rating)` — apply a specific rating
- `scheduler.get_retrievability(card, now)` — current recall probability
- `scheduler.next_state(state, elapsed, rating)` — raw state transition
- `scheduler.next_interval(stability, elapsed)` — interval calculation
- `scheduler.rollback(card, log)` — undo a review
- `scheduler.forget(card, now, reset_count?)` — reset card
- `scheduler.reschedule(card, reviews, options?)` — replay history
- `forgetting_curve(elapsed, stability, decay?)` — raw curve calculation
- `generatorParameters(partial)` — build full parameter set
- Types: `Card`, `Rating`, `State`, `FSRSParameters`, `FSRSState`,
  `ReviewLog`, `SchedulingCards`

**Browser compatibility:**

- Pure TypeScript with zero runtime dependencies — no Node-only imports
- Published as ESM + CJS + UMD; works in browsers via bundler or CDN
- Official browser example provided
- Dates use standard `Date` objects (no `node:timers` or similar)

**Tree-shaking / bundle size:**

- ESM format with named exports enables tree-shaking
- Zero runtime dependencies means minimal effective bundle cost
- 74 published versions indicate mature, incremental releases

**Storage agnosticism:**

- All Card/Log types are serializable plain objects
- Dates stored as `Date` instances; can be mapped to timestamps via
  `afterHandler` in `scheduler.next()`
- No built-in persistence — fully decoupled from storage layer
- Compatible with IndexedDB/Dexie or any persistence adapter

**Known limitations:**

- `engines.node >=20.0.0` in package.json (build-time requirement only;
  output is browser-compatible JS)
- v6 defaults require no optimization, but full v6 benefit requires running
  the separate `@open-spaced-repetition/binding` optimizer (WASM-based)
- Card type uses `Date` objects; serialization to/from IndexedDB requires
  explicit conversion

### Candidate 2: `@squeakyrobot/fsrs`

| Attribute | Value |
|---|---|
| **npm package** | `@squeakyrobot/fsrs` |
| **Latest stable version** | 1.0.0 |
| **Published** | ~5 months ago (early 2026) |
| **GitHub stars** | 3 |
| **License** | MIT |
| **npm weekly downloads** | Low (not in top results) |
| **Runtime dependencies** | 0 |
| **Node.js requirement** | >=18 |
| **FSRS algorithm version** | v4.5 core, optional v6 |
| **Module formats** | ESM, CJS |
| **TypeScript declarations** | Built-in |
| **Maintainer** | squeakyrobot (individual) |
| **GitHub commits** | 7 |
| **Open issues** | 0 |
| **Browser example** | Edge runtime example (Cloudflare Workers) |

**API surface:**

- `new FSRS(params?)` — create scheduler instance
- `fsrs.createEmptyCard(now?)` — new card
- `fsrs.repeat(card, now)` — preview all ratings
- `fsrs.scheduleWithGrade(card, grade, now)` — apply rating
- `fsrs.autoRating(responseTime, avgTime, difficulty?)` — auto-grade from
  response time
- `fsrs.getRetrievability(card, now)` — recall probability
- `fsrs.getNextInterval(card, rating, now)` — preview interval
- Utility: `isLapse(grade)` — check if grade is a failure
- Types: `Card`, `Rating`, `State`, `FSRSParameters`, `ContinuousRating`

**Browser compatibility:**

- Pure TypeScript, zero dependencies
- Explicitly marketed as "Edge Runtime Ready" (Cloudflare Workers, Vercel
  Edge, Deno Deploy)
- No Node-only imports

**Tree-shaking / bundle size:**

- ESM with `"sideEffects": false` in package.json — optimal for tree-shaking
- Built with `tsup` (esbuild-based)
- Zero dependencies

**Storage agnosticism:**

- Card type uses `Date` objects for `due` and `last_review`
- No built-in persistence
- Compatible with any storage layer

**Known limitations:**

- Very new (v1.0.0, 7 commits, 3 stars) — minimal community validation
- Not listed in awesome-fsrs as an official implementation
- No browser-specific examples (only edge runtime / Cloudflare Workers)
- FSRS v4.5 is the core; v6 support is secondary
- No `rollback`, `forget`, or `reschedule` helpers
- Single maintainer with no org backing

### Candidate 3: `fsrs-browser`

| Attribute | Value |
|---|---|
| **npm package** | `fsrs-browser` |
| **Latest stable version** | 6.6.0 |
| **Published** | June 2026 (~1 month ago) |
| **GitHub stars** | 52 |
| **License** | BSD-3-Clause |
| **npm weekly downloads** | Low |
| **Runtime dependencies** | 0 |
| **FSRS algorithm version** | v6 (Rust core via WASM) |
| **Module formats** | ESM, CJS, TS |
| **TypeScript declarations** | Built-in |
| **Maintainer** | open-spaced-repetition org (Alex Errant, Jarrett Ye) |
| **GitHub commits** | 196 |
| **Package size** | 378 kB (WASM binary) |
| **Browser support** | Primary target — runs fsrs-rs in browser via WASM |

**Key characteristics:**

- Wraps the Rust `fsrs-rs` implementation via WebAssembly
- Includes both Scheduler and Optimizer in the browser
- Major/minor versions track `fsrs-rs` upstream
- Built and signed on GitHub Actions with provenance

**Known limitations:**

- 378 kB WASM binary — significantly larger than pure TS alternatives
- BSD-3-Clause license (not MIT) — different from ChessRemedy's MIT
- WASM adds complexity to the build pipeline
- Scheduler-only use case doesn't justify WASM overhead
- Optimizer (training) is rarely needed in a browser SPA
- No `sideEffects` field observed in package metadata

## Comparison Table

| Criterion | ts-fsrs | @squeakyrobot/fsrs | fsrs-browser |
|---|---|---|---|
| **Version** | 5.4.1 | 1.0.0 | 6.6.0 |
| **FSRS version** | v6 | v4.5 (v6 optional) | v6 |
| **License** | MIT | MIT | BSD-3-Clause |
| **GitHub stars** | 769 | 3 | 52 |
| **npm weekly DL** | 93,036 | Low | Low |
| **Dependencies** | 0 | 0 | 0 |
| **Runtime deps** | None | None | WASM binary |
| **Module formats** | ESM/CJS/UMD | ESM/CJS | ESM/CJS |
| **sideEffects** | Not set | `false` | Not set |
| **TypeScript** | Full | Full | Full |
| **Browser compatible** | Yes | Yes (edge runtime) | Yes (WASM) |
| **Tree-shakeable** | Yes (ESM) | Yes (ESM + sideEffects) | Partial (WASM blob) |
| **Bundle size** | Minimal (pure TS) | Minimal (pure TS) | ~378 kB (WASM) |
| **Persistence helpers** | rollback, forget, reschedule | None | None |
| **afterHandler** | Yes | No | No |
| **retrievability** | Yes | Yes | Yes |
| **Auto-rating** | No | Yes | No |
| **Maintained by** | Org (ishiko732) | Individual | Org (Alex Errant) |
| **Community adoption** | High (Anki ecosystem) | Low | Moderate |
| **awesome-fsrs listed** | Yes | No | Yes (via fsrs-rs) |

## Recommendation

**Use `ts-fsrs` v5.4.1** for ChessRemedy V1 puzzle scheduling.

### Reasoning

1. **API quality for puzzle scheduling.** ts-fsrs provides the most complete
   API surface for ChessRemedy's needs: `repeat()` for previewing all rating
   outcomes, `next()` for applying ratings, `get_retrievability()` for
   retention metrics, and `afterHandler` for mapping card state into
   Dexie-storable types. The `rollback`, `forget`, and `reschedule` helpers
   are essential for importing review history and handling corrections.

2. **Browser compatibility.** Pure TypeScript with zero runtime dependencies.
   No Node-only imports. Official browser example provided. Works in any
   modern browser via Vite/Rollup bundling.

3. **Storage agnosticism.** All Card and ReviewLog types are serializable
   plain objects. The `afterHandler` in `scheduler.next()` allows direct
   mapping to timestamp-based storage formats compatible with IndexedDB/Dexie.
   No coupling to any persistence layer.

4. **Maintenance and stability.** Backed by the open-spaced-repetition
   organization (769 GitHub stars, 283 commits, 93k weekly npm downloads).
   74 published versions over 3+ years. Listed in awesome-fsrs as the
   official TypeScript implementation. Actively tracks FSRS algorithm updates
   (currently v6).

5. **License compatibility.** MIT license is fully compatible with
   ChessRemedy's licensing requirements.

6. **Algorithm currency.** Implements FSRS v6 (latest), ensuring ChessRemedy
   benefits from the most recent algorithm improvements. Default parameters
   work well without requiring user-specific optimization.

### Why not the alternatives?

- **@squeakyrobot/fsrs**: Too new (v1.0.0, 3 stars, 7 commits). Not listed
  in awesome-fsrs. Single maintainer with no org backing. Missing critical
  persistence helpers (`rollback`, `forget`, `reschedule`). v4.5-first
  design requires explicit v6 configuration.

- **fsrs-browser**: 378 kB WASM binary is unjustified for scheduler-only
  use. BSD-3-Clause license differs from ChessRemedy's MIT. WASM adds build
  complexity. Optimizer functionality is unnecessary for V1 (user-side
  scheduling doesn't need parameter training).

## Impact on ChessRemedy

### Integration points

- **Puzzle scheduling**: `scheduler.repeat(card, now)` generates the four
  possible scheduling outcomes for each puzzle rating (Again/Hard/Good/Easy)
- **Due date calculation**: `card.due` provides the next review timestamp
- **Retention metrics**: `scheduler.get_retrievability(card, now)` enables
  "cards due" and "retention rate" analytics
- **History import**: `scheduler.reschedule(card, reviews)` allows replaying
  imported Chess.com/Lichess game review history
- **Card persistence**: Card objects map directly to Dexie table schema with
  timestamp conversion

### Required adapter layer

ChessRemedy should create a thin adapter between ts-fsrs `Card` objects and
IndexedDB storage:

```ts
// ts-fsrs Card -> IndexedDB
function cardToStorable(card: Card): StorableCard {
  return {
    ...card,
    due: card.due.getTime(),
    last_review: card.last_review?.getTime() ?? null,
  }
}

// IndexedDB -> ts-fsrs Card
function storableToCard(storable: StorableCard): Card {
  return {
    ...storable,
    due: new Date(storable.due),
    last_review: storable.last_review ? new Date(storable.last_review) : null,
  }
}
```

This adapter should use the `afterHandler` parameter in `scheduler.next()` for
efficient one-pass conversion during review.

### Bundle impact

ts-fsrs has zero runtime dependencies and is tree-shakeable. Expected bundle
contribution: <5 kB gzipped (estimated based on zero-dep ESM package with
pure math logic).

## Open questions

1. **FSRS v6 default parameters**: Are the default v6 parameters suitable for
   chess puzzle scheduling, or should ChessRemedy use v4.5 defaults? The
   algorithm was designed for flashcard-style learning; chess puzzles may have
   different difficulty characteristics. Initial implementation should use
   defaults and collect data before tuning.

2. **Rating mapping**: ChessRemedy puzzle ratings (solved correctly with
   difficulty rating, solved incorrectly, skipped) need to map to FSRS
   ratings (Again/Hard/Good/Easy). This mapping requires a domain decision
   in the puzzle scheduling specification.

3. **Optimizer integration**: The `@open-spaced-repetition/binding` package
   provides WASM-based parameter optimization. This is a build-time concern
   (training offline) and does not affect runtime bundle size. It could be
   added in a future iteration if ChessRemedy accumulates enough review data
   for personalized parameters.

4. **Fuzz behavior**: ts-fsrs supports `enable_fuzz` which adds random
   interval jitter. This should be enabled to prevent synchronized review
   spikes when many puzzles are scheduled together.
