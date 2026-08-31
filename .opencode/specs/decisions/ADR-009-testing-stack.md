# ADR-009: Testing Stack

## Status

Accepted

## Decision

Use the following testing stack for ChessRemedy V1:

- **Unit/component tests:** Vitest 4.x
- **React component testing:** @testing-library/react 16.x +
  @testing-library/user-event 14.x
- **DOM environment:** happy-dom 20.x (default),
  jsdom 30.x (on-demand via `// @vitest-environment jsdom`)
- **IndexedDB testing:** fake-indexeddb 6.x
- **Network mocking:** MSW 2.x (Node)
- **Browser integration tests:** Playwright 1.x
- **Coverage:** @vitest/coverage-v8

## Reasons

- Vitest is Vite-native and reuses the application `vite.config.ts`
  (path aliases, Chessground resolve, future `vite-plugin-pwa`).
  No parallel Babel or tsconfig translation is needed.
- ESM-first, TypeScript-first, Jest-compatible API surface.
- React 19 support via @testing-library/react 16.x (onCaughtError
  type inference).
- happy-dom is fast for default component tests; jsdom is available
  on-demand for CSS/computedStyle fidelity.
- fake-indexeddb works with Dexie unmodified in Node tests.
- MSW v2 provides shared network fixtures between Vitest and Playwright.
- Playwright is the only candidate with first-class Web Worker APIs
  (`page.workers()`) for real-browser Stockfish-in-Worker testing.
- Two CI jobs: fast unit/component (`vitest run`) and slower browser
  (`playwright test` against `vite preview`).

## Consequences

- Domain code must remain framework-agnostic so it can be tested in
  Node with Vitest without React or DOM imports.
- The engine service must be a separate module from the worker bootstrap
  so the UCI protocol can be unit-tested in Node.
- Network adapters (Chess.com, Lichess) must accept a fetch-compatible
  transport so MSW can intercept calls in Node tests.
- IndexedDB access must be funneled through Dexie. Tests construct the
  Dexie database against `fake-indexeddb` in Node and real IndexedDB
  in Playwright.

## Non-V1 deferrals

The following are explicitly not part of V1:

- Storybook and @storybook/test-runner
- Visual regression tooling (Chromatic, Percy)
- Mutation testing (Stryker)
- Cypress component testing
- Vitest browser mode as the primary test path

## Source

`specs/research/testing-stack.md`
