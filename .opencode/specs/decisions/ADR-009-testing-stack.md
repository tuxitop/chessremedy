# ADR-009: Testing Stack

## Status

Accepted

## Decision

ChessRemedy V1 uses the following testing stack:

- **Unit/component tests:** Vitest
- **React component testing:** @testing-library/react +
  @testing-library/user-event
- **DOM environment:** happy-dom (default), jsdom (on-demand via
  `// @vitest-environment jsdom`)
- **IndexedDB testing:** fake-indexeddb
- **Network mocking:** MSW (Node); installed only by the feature
  that uses it (initially Feature 006 Game Import)
- **Browser integration tests:** Playwright
- **Coverage:** @vitest/coverage-v8

Exact versions are not pinned here. They follow the **Dependency
policy in `AGENTS.md`** (latest stable by default). The
`package.json` caret ranges and the lockfile are the source of truth
for the actual versions in use.

## Reasons

- Vitest is Vite-native and reuses the application `vite.config.ts`
  (path aliases, future `vite-plugin-pwa`). No parallel Babel or
  tsconfig translation is needed.
- ESM-first, TypeScript-first, Jest-compatible API surface.
- `@testing-library/react` (current major) adds React 19 type
  inference including `onCaughtError` for React 19's error-boundary
  API, so `render`/`renderHook` type-check cleanly against React 19
  without `@ts-expect-error`.
- happy-dom is fast for default component tests; jsdom is available
  on-demand for CSS/computedStyle fidelity.
- fake-indexeddb works with Dexie unmodified in Node tests.
- MSW v2 provides shared network fixtures between Vitest and
  Playwright (when its consumer feature lands).
- Playwright is the only candidate with first-class Web Worker APIs
  (`page.workers()`) for real-browser Stockfish-in-Worker testing.
- Two CI jobs: fast unit/component (`vitest run`) and slower browser
  (`playwright test` against `vite preview`).

## Consequences

- Domain code must remain framework-agnostic so it can be tested in
  Node with Vitest without React or DOM imports.
- The engine service must be a separate module from the worker
  bootstrap so the UCI protocol can be unit-tested in Node.
- Network adapters (Chess.com, Lichess) must accept a
  fetch-compatible transport so MSW can intercept calls in Node
  tests.
- IndexedDB access must be funnelled through Dexie. Tests construct
  the Dexie database against `fake-indexeddb` in Node and real
  IndexedDB in Playwright.

## Non-V1 deferrals

The following are explicitly not part of V1:

- Storybook and @storybook/test-runner
- Visual regression tooling (Chromatic, Percy)
- Mutation testing (Stryker)
- Cypress component testing
- Vitest browser mode as the primary test path

## Source

`specs/research/testing-stack.md`
