# Testing Stack Research for ChessRemedy V1

## Question

Which current (mid-2026) TypeScript / React / Vite testing stack best covers the
full testing surface of ChessRemedy V1: pure-domain logic, React component
tests, Web Worker tests, IndexedDB / Dexie tests, browser-level integration
tests, and a CI-friendly workflow — without adding tools whose cost exceeds
their value?

## Sources

Primary sources consulted (release pages are the source of truth for version
and maintenance status):

- Vitest — `vitest.dev`, github.com/vitest-dev/vitest/releases.
- Playwright — `playwright.dev`, github.com/microsoft/playwright/releases.
- Jest — github.com/jestjs/jest/releases.
- React Testing Library — testing-library.com/docs/react-testing-library,
  github.com/testing-library/react-testing-library/releases.
- @testing-library/user-event — github.com/testing-library/user-event/releases.
- jsdom — github.com/jsdom/jsdom/releases.
- happy-dom — github.com/capricorn86/happy-dom/releases.
- fake-indexeddb — github.com/dumbmatter/fakeIndexedDB/releases.
- MSW — github.com/mswjs/msw/releases.
- Cypress — github.com/cypress-io/cypress/releases.
- @web/test-runner — github.com/modernweb-dev/web/releases.
- Storybook — github.com/storybookjs/storybook/releases.
- Vite testing guidance — vitest.dev, vitest browser mode docs.

Internal project context consulted:

- `.opencode/specs/PRODUCT.md`
- `.opencode/specs/ARCHITECTURE.md`
- `.opencode/specs/decisions/ADR-001..ADR-008.md`
- `.opencode/specs/domain/*.md` (analysis-model, classification, game-model,
  puzzle-model, statistics, tactics)
- `.opencode/specs/features/*.md` (foundation through synchronization)
- `.opencode/specs/research/{move-accuracy, move-classification,
  tactical-detection, puzzle-generation, browser-stockfish}.md`

## Findings

### Versions and maintenance status (mid-2026)

| Tool                       | Latest stable          | Released       | Maintained by                       | Status                                                                                       |
| -------------------------- | ---------------------- | -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Vitest                     | 4.1.11                 | 2026-08-18     | VoidZero / Vitest team              | Active. 5.0.0-rc.2 published 2026-08-17.                                                     |
| Playwright                 | 1.62.1                 | 2026-07-30     | Microsoft                           | Active. Monthly cadence.                                                                     |
| Jest                       | 30.4.2                 | 2026-05-09     | Jest / OpenJS                       | Active. React 19 supported in `pretty-format`; new ESM runtime rewrite in 30.4.0.             |
| React Testing Library      | 16.3.2                 | 2026-01-19     | Testing Library                     | Active. React 19 supported since 16.1.0 (2024-12). `@testing-library/dom` is peer.           |
| @testing-library/user-event| 14.6.6                 | 2026-08-22     | Testing Library                     | Active.                                                                                      |
| jsdom                      | 30.0.1                 | 2026-07-29     | Domenic (@domenic)                  | Active. Major CSSOM rewrite in 30.0.0 (Node ≥ 22.22.2 / 24.15 / 26).                         |
| happy-dom                  | 20.11.6                | 2026-08-19     | @capricorn86                        | Active.                                                                                      |
| fake-indexeddb             | 6.2.5                  | 2025-11-07     | @dumbmatter, @nolanlawson           | Active but slow cadence (last release ~10 months ago). Tracks WPT; `forceCloseDatabase` added 2025-08. |
| MSW                        | 2.15.0                 | 2026-07-08     | @kettanaito / MSWJS                 | Active. v2 stable since 2023; `WebSocketHandler` and SSE finalization added in 2026.         |
| Cypress                    | 15.21.1                | 2026-08-25     | Cypress.io                          | Active. Major-version cadence accelerated in 2024–2025.                                      |
| @web/test-runner           | 1.0.1 (`@web/dev-server-core`) | 2026-07-27 | modernweb-dev / open-wc             | Stable at 1.0.1. Repository activity has slowed; releases since 2024 are mostly patch updates bumping Puppeteer / esbuild. |
| Storybook                  | 10.5.10 (stable)       | 2026-08-20     | Storybook maintainers / Chromatic   | Active. v10.6.0-alpha.9 published 2026-08-26. Interaction tests are first-class.              |

All projects referenced above are alive in mid-2026. None of the candidates
considered has been archived.

### Stacks under consideration

For each candidate stack the assessment below reflects a 2026-08 evaluation.

#### A. Vitest + React Testing Library + Playwright

- **Vitest 4.1.11**: Vite-native, ESM-first, TypeScript and JSX handled out of
  the box. Re-uses the application Vite config, including `vite-plugin-pwa`
  configuration if needed. Watch mode is HMR-equivalent. Jest-compatible
  API surface (`vi.fn`, `vi.mock`, `vi.useFakeTimers`, `expect`,
  `describe`/`it`).
- **Browser mode** (`vitest --browser`) is real-browser execution using
  Playwright / WebdriverIO / Puppeteer providers, but the Vitest docs
  themselves describe it as "early stages of development" and recommend
  augmenting with Playwright or Cypress for full browser tests. As of v4,
  browser mode is improving rapidly (v5.0-rc has additional provider fixes),
  but it is not yet the recommended primary path for production code.
- **Component tests** via `@testing-library/react` 16.3.2 + `user-event`
  14.6.6. RTL peer-depends on `@testing-library/dom` (since v16).
- **Environment choices**: jsdom 30.0.1 or happy-dom 20.11.6. happy-dom is
  substantially faster (typically 2–5× on cold start and DOM-heavy tests),
  with more limited API coverage (e.g. CSS computed styles are still
  narrower). jsdom is more spec-complete and is what Jest uses by default.
  Vitest lets you switch per-project or per-file via `// @vitest-environment
  happy-dom`.
- **Worker tests**: Vitest's `pool: 'threads'` (default) supports real
  `new Worker()` calls. Vitest also exposes `workerThreads` / `vmThreads`
  pool options. Tests can import the Stockfish service module and call the
  worker the same way the UI does. No extra config required.
- **IndexedDB**: in Node tests, use `fake-indexeddb/auto` (or
  `fake-indexeddb/src/auto`, depending on bundler) which installs an IDB
  factory and structured-clone polyfill onto `globalThis`. Dexie is
  compatible; we run Dexie schemas unchanged.
- **Network mocking**: MSW v2 in Node runs via `setupServer` against the
  internal `fetch` / XHR. In Vitest, MSW works in both node and
  browser-mode environments.
- **Browser integration tests**: Playwright 1.62.1 drives a real Chromium /
  Firefox / WebKit against the built app (Vite preview / PWA). Playwright
  has first-class Worker APIs (`page.workers()`) and `WorkerInfo` reporting.
  This is the recommended path for the PWA, offline-mode, and Stockfish
  integration tests.
- **Coverage**: Vitest ships with `@vitest/coverage-v8` and
  `@vitest/coverage-istanbul`. V8 is faster and recommended for Vite
  projects; istanbul is more reliable on edge runtimes.
- **Strengths**: single config (`vitest.config.ts`) shared with the app,
  fastest developer loop, real-ESM, no Jest config translation, no Babel.
  React 19 + concurrent rendering works because `@testing-library/react`
  16.3.2 added `onCaughtError` type inference specifically for React 19.
- **Weaknesses**: Vitest is still adding API surface; some Jest plugins do
  not have equivalents. Browser mode is not mature enough for the
  Stockfish-in-Worker integration tests; that work is delegated to
  Playwright.

#### B. Jest + React Testing Library + Playwright

- **Jest 30.4.2**: stable, mature. ESM support improved substantially in
  v30 (custom runtime rewrite; `require(esm)` on Node 24.9+). React 19
  snapshot support landed in `pretty-format` in v30.4.0.
- **Vite compatibility**: Jest does not read `vite.config.ts`. The project
  needs `ts-jest` / `@swc/jest` / `babel-jest` for TypeScript and JSX.
  Path aliases, asset imports, and Vite plugins must be re-declared in
  `jest.config.ts`. This is friction Vite projects usually want to avoid.
- **jsdom**: Jest 30 ships with `jest-environment-jsdom` against jsdom 30
  via the abstract package (jsdom 27 added in v30.2.0). happy-dom is
  available via `jest-environment-happy-dom`.
- **Worker tests**: Jest's worker support is via `jest-environment-node`
  + `worker_threads`. Works, but no first-class integration with the Vite
  config. Real Web Workers need to be stubbed or driven via `jsdom`-style
  shims depending on the test.
- **IndexedDB**: same `fake-indexeddb/auto` pattern works with Jest.
- **Browser integration**: Playwright is again the standard companion.
  Cypress component testing is also compatible but is a parallel stack.
- **Strengths**: most widely documented; huge plugin ecosystem; very
  mature snapshot tooling; well-known to the React community.
- **Weaknesses**: duplicates Vite config; slower cold start; ESM story is
  still playing catch-up; Jest has no `worker_threads` pool semantics;
  larger dependency footprint.

#### C. Vitest + @testing-library/react + Playwright (with happy-dom / jsdom / real browser)

This is the same stack as (A), but the question is which DOM environment to
pick. The realistic trade-off:

- **happy-dom** for component tests where DOM fidelity is not critical
  (most puzzle UI, dashboard chrome, layout). Speed wins on a project that
  will grow to hundreds of component tests.
- **jsdom** for component tests where spec fidelity matters (anything
  using `getComputedStyle`, modern CSS, `Element.checkVisibility`, or
  relying on jsdom-specific event ordering).
- **Real browser (Playwright + Vitest browser mode provider, OR
  Playwright component tests directly)** for the chessboard wrapper
  component, because Chessground relies on real DOM measurement APIs and
  on the actual pointer-event flow.

ChessRemedy's chessboard wrapper is the most plausible reason to keep a
real-browser test in scope; everything else is comfortable in jsdom or
happy-dom.

#### D. Cypress + Cypress Component Testing

- **Cypress 15.21.1**: stable. Component Testing is bundled in the
  Cypress app.
- **Browser engine**: Cypress runs against a real browser (Chromium /
  Firefox / WebKit in 15.x). Cypress has historically been Electron-only;
  the v15 series is the multi-browser release that the project has been
  promising since 2023.
- **Strengths**: best-in-class interactive runner and time-travel
  debugging; auto-waiting assertions; built-in screenshot and video.
- **Weaknesses**: heavy install footprint (downloads a managed browser
  binary). Cypress component tests run inside an iframe controlled by
  Cypress, which limits how you exercise Web Workers and IndexedDB.
  Cypress does not natively understand Vite's HMR boundary — there is
  `cypress/vite-dev-server`, but the story is less direct than Vitest.
  Cypress test fixtures do not run in real Node, so pure-domain logic tests
  are awkward.
- **For ChessRemedy**: viable for browser-level end-to-end tests of the
  PWA, but no obvious advantage over Playwright for V1. Playwright has
  stronger Worker APIs and multi-browser parity for the same workload.

#### E. @web/test-runner (Web Test Runner) + @testing-library/react

- **@web/test-runner 1.0.1** + `@web/dev-server-core` 1.0.1 (Jul 2026):
  stable, but the project is in maintenance mode. Most 2025–2026 releases
  are dependency bumps (Puppeteer 25, esbuild 0.27). The repository's
  open issues and PR queue reflect this slowdown.
- **Strengths**: tests run in real browsers via Puppeteer or
  `@web/test-runner-playwright`. Excellent Vite / Rollup integration (the
  project is the same family as `@web/dev-server`). No Babel, no Jest
  config translation, ESM-first.
- **Weaknesses**: smaller ecosystem than Vitest or Playwright; documentation
  assumes you are already an open-wc / Lit / Web Components user; less
  out-of-the-box support for React Testing Library ergonomics (you wire
  `@open-wc/testing-helpers` or use raw `@testing-library/react`).
- **For ChessRemedy**: technically viable, but the project's slower release
  cadence and smaller ecosystem make it a harder sell when Vitest covers
  the same needs with active development and broader community traction.

#### F. Storybook interaction testing

- **Storybook 10.5.10** (stable) ships `@storybook/test-runner` for
  interaction tests and visual regression. Stories are run in a real
  browser. Vitest is integrated through `@storybook/addon-vitest` for
  component-level tests.
- **Status**: first-class, but adds a substantial new tool (Storybook
  server, build pipeline, addon manager). It is a product-development
  surface in its own right and is not free for ChessRemedy V1.
- **For ChessRemedy**: explicitly out of scope for V1. Visual regression on
  the chessboard wrapper is the most plausible future use, but it should
  not be part of the V1 stack.

### Cross-cutting facts

- **ESM / Vite native**: only Vitest (and WTR) reuse the application Vite
  config. Jest requires a parallel config.
- **React 18 / 19 concurrent rendering**: RTL 16.3.2 supports React 19
  (`onCaughtError` type), and Vitest 4 has no known regressions with
  React 19. Jest 30.4.0 also supports React 19 snapshots. Cypress is
  neutral.
- **Concurrent rendering traps**: any framework using React 19's
  `useTransition`, `useDeferredValue`, or `Suspense` boundaries needs an
  RTL version that handles these. RTL 16.1.0+ does. All candidates above
  qualify.
- **Web Worker test ergonomics**: Vitest `pool: 'threads'` and
  `pool: 'forks'` both allow real `Worker` and `WorkerGlobalScope`. Jest
  `jest-environment-node` supports `worker_threads` but requires more
  setup. Playwright is the only candidate that can exercise a real
  production worker in a real browser.
- **IndexedDB in Node**: `fake-indexeddb` 6.2.5 works equally well with
  Vitest and Jest. Dexie has no preference.
- **IndexedDB in the browser**: Playwright tests use the real browser
  IndexedDB. Tests that need a clean DB can use Playwright's
  `BrowserContext.storageState` and Dexie's `delete()`.
- **Mocking network**: MSW v2.15.0 is the de facto choice. It works with
  Vitest (node and browser) and with Playwright (via
  `page.route()` or by adding MSW as a service worker in test mode).
  Cypress intercepts can replace MSW if Cypress is the chosen browser
  stack, but MSW still works inside component tests.
- **CI cost**: Playwright downloads ~150–300 MB of browser binaries on
  first run. Subsequent runs reuse cache. Vitest and Jest are pure-Node
  and cheap. Cypress is comparable to Playwright in CI cost.

## Limitations

- We did not actually install or benchmark any of these tools in this
  repository — `package.json` is intentionally not modified. Version data
  and feature claims above are taken from the official release pages and
  documentation as of August 2026. Empirical benchmarks should be
  confirmed during the foundation implementation.
- The Vitest browser-mode maturity claim ("early stages of development,
  bugs may exist") is taken from the official Vitest documentation. The
  project is releasing fast (5.0.0-rc.2 on 2026-08-17) and may improve
  before any feature in ChessRemedy V1 actually depends on it.
- Cypress 15 is the first multi-browser release after a long roadmap.
  Real-world stability in production CI for Firefox and WebKit targets is
  still maturing and may surface regressions not yet documented.
- fake-indexeddb's release cadence has slowed (the most recent release
  before v6.2.5 was v6.2.4 in October 2025). It is not abandoned, but
  ChessRemedy should pin the version explicitly and monitor.
- Coverage tooling comparison: `@vitest/coverage-v8` and `nyc` / istanbul
  produce equivalent results for our domain logic, but coverage of
  `chess.js` and the Stockfish worker wrapper is only meaningful if we
  instrument the wrapper, not the underlying engine binary. This document
  does not pick a coverage threshold; that is a separate decision.
- Component tests do not guarantee correctness of the chessboard wrapper.
  Chessground's behavior around drag-and-drop and SVG layering is best
  validated with a real browser test. The recommendation below treats
  Playwright as authoritative for that surface.
- React 19 + RTL + Vitest interaction is well-supported, but if the
  project ever adopts React Server Components, the testing story changes
  again. This is out of scope for V1.

## Recommendation

Adopt **Vitest + @testing-library/react + @testing-library/user-event +
fake-indexeddb + MSW (Node) + Playwright** as the V1 testing stack.

The reasoning, broken out by the categories the brief calls out:

- **Domain unit tests (chess.js, classification, tactics, puzzles, FSRS,
  statistics)** — Vitest in Node with the default `node` environment.
  Pure functions need no DOM. Use `pool: 'threads'` if these suites grow
  large enough that cold-start time matters.

- **React component tests (chessboard wrapper, puzzle UI, dashboard)** —
  Vitest with **happy-dom as the default DOM environment** and
  `// @vitest-environment jsdom` for the few components that depend on
  css-tree / getComputedStyle fidelity. RTL 16.3.2 + `user-event` 14.6.6.
  Vitest's shared Vite config means Vite path aliases, the
  `@lichess-org/chessground` resolve, and any future `vite-plugin-pwa`
  config "just work" in tests.

- **Web Worker tests (Stockfish engine service)** — Vitest in Node with
  `pool: 'threads'` and the `Worker` constructor imported from
  `node:worker_threads` polyfilled via `vitest/config`'s
  `defineWorker`/`?worker` Vite import suffix. The Stockfish WASM is
  exercised in the worker the same way the UI does it. This catches
  protocol-level regressions (wrong UCI command, missing `bestmove`
  handling) without needing a real browser.

- **IndexedDB / Dexie tests** — `fake-indexeddb/auto` installed as a test
  setup file, Dexie schemas constructed against the fake store. Playwright
  tests verify the same code paths against real IndexedDB in a real
  browser.

- **Browser integration tests (PWA, offline, Stockfish-in-Worker end-to-end,
  game import via MSW)** — Playwright. Use `page.workers()` for worker
  visibility, `page.route()` (or MSW as a service worker) for the
  Chess.com and Lichess adapter stubs, and the WebKit project for
  touch-event coverage (mobile is a first-class requirement of V1 per
  PRODUCT §13).

- **CI practicality** — Two matrix jobs: a fast unit/component job
  (`vitest run` on Node) and a slower browser job (`playwright test`
  against a `vite preview` build). Playwright's browser binaries can be
  cached; Vitest needs no special caching. Total wall time on a 3-broker
  GitHub Actions runner is roughly 60–90s for unit, 2–4 min for browser,
  in line with typical Vite SPA projects.

- **Future-proofing (React 19, Vite 5/6, future Vite versions)** —
  Vitest is developed by VoidZero alongside Vite, so version alignment is
  the best of the candidates. Jest does not have this advantage. RTL
  16.x has React 19 support and tracks React's official testing
  recommendations. Playwright is the most stable multi-year bet of any
  browser tool.

### Explicit non-V1 deferrals

The following are **not** part of V1 and should not be installed:

- **Storybook and `@storybook/test-runner`** — Defer. Useful for design
  review of the chessboard wrapper and for visual regression, but adds a
  large build pipeline with its own dependencies (Vite builder, addon
  manager, test-runner) and a separate mental model. Revisit after the
  core flows are green.
- **Visual regression tooling (Playwright snapshots, Chromatic,
  Percy)** — Defer until component surfaces stabilize. Today the
  chessboard is the only visual surface with significant complexity, and
  Playwright's screenshot assertions are sufficient for that.
- **Mutation testing (Stryker, `vitest --mutant`)** — Defer. Domain logic
  coverage with V8 is enough for V1. Re-evaluate when classification,
  tactics, or puzzle-generation becomes the largest source of bugs.
- **Cypress component testing** — Defer. Playwright already covers the
  browser layer. Cypress would duplicate that surface area for no clear
  gain.
- **Vitest browser mode (`vitest --browser`) as the primary path** — Do
  not rely on it for Stockfish-in-Worker integration yet; the docs
  themselves flag it as early-stage. Re-evaluate at v5.0 stable.

### Concrete version pins for the recommendation (informational)

These are the versions to evaluate during foundation implementation. Do
not install during research.

- `vitest@^4.1.11`
- `@vitest/coverage-v8@^4.1.11`
- `@testing-library/react@^16.3.2`
- `@testing-library/dom` (peer)
- `@testing-library/user-event@^14.6.6`
- `@testing-library/jest-dom@^6.x`
- `happy-dom@^20.11.6` (default), `jsdom@^30.0.1` (on-demand)
- `fake-indexeddb@^6.2.5`
- `msw@^2.15.0`
- `@playwright/test@^1.62.1`

## Impact on ChessRemedy

- Domain code must remain framework-agnostic so it can be tested in Node
  with Vitest without React or DOM imports. This aligns with
  `ARCHITECTURE.md §3` (Domain layer separation).
- The chessboard wrapper component must be importable in both
  happy-dom / jsdom (component tests) and a real Chromium / WebKit
  (Playwright). The wrapper's public API already targets this: it is a
  React component, not a side-effecting module.
- The Stockfish engine service must be a separate module from the worker
  bootstrap, so the engine protocol (UCI commands, result handling) can
  be unit-tested in Node without spinning up a browser. The architecture
  decision `ADR-004-stockfish.md` already calls for an "engine service"
  abstraction; this recommendation reinforces that boundary.
- IndexedDB access must be funneled through Dexie. Tests will construct
  the Dexie database against `fake-indexeddb` in Node and against the
  real IndexedDB in Playwright. The Dexie schema lives in
  `infrastructure/` and is replaced via dependency injection in tests.
- Network adapters (Chess.com, Lichess) must accept a fetch-compatible
  transport so MSW can intercept calls in Node tests and Playwright's
  `page.route()` can intercept them in browser tests. No adapter should
  import `fetch` from a concrete global.
- CI configuration is a future ADR. The recommendation here implies two
  jobs (unit + browser) but does not prescribe a specific runner.
- PWA / offline verification is the responsibility of Playwright. A single
  end-to-end test that loads the app, kills the network, and verifies
  that puzzle solving continues is the minimum useful Playwright suite.

## Open questions

- **Vitest 4 → 5 timing**: 5.0.0-rc.2 is on the verge of release. Should
  V1 adopt 4.x stable or ride the 5.0 release? Recommendation is 4.x
  stable for now; revisit at 5.0.0 GA.
- **happy-dom vs jsdom as default**: happy-dom is faster but has narrower
  CSS / event behavior. We should make the decision at foundation time
  based on the chessboard wrapper's actual needs. Defaulting to
  happy-dom and using `// @vitest-environment jsdom` for outliers is the
  safest compromise.
- **MSW in Playwright**: Use `page.route()` directly, or run MSW inside
  Playwright as a service worker? Both are valid. `page.route()` is
  simpler; MSW gives shared fixtures between Vitest and Playwright
  tests. Decide during the game-import feature.
- **Coverage threshold**: not set in this research. To be decided with
  the team when the foundation feature is implemented.
- **Visual regression cadence**: should the chessboard snapshots run on
  every PR, nightly, or only on tagged commits? Defer until Storybook /
  visual tooling is adopted.
- **Browser matrix in Playwright**: Chromium-only on PRs, full
  Chromium / Firefox / WebKit on main + nightly? The product targets
  desktop and mobile, so WebKit (Safari / iOS) is a meaningful CI
  signal.
- **fake-indexeddb stability**: confirm during foundation that Dexie's
  upgrade path works correctly against `fake-indexeddb` 6.x. The two
  are independent projects and Dexie's IndexedDB upgrade tests should
  not be the only source of truth.
