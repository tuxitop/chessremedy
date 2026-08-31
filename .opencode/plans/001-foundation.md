# Implementation Plan — Feature 001 (Foundation)

Status: Draft for review
Target feature: `.opencode/specs/features/001-foundation.md`
Author: planner (no implementation work performed)

---

## 1. Objective

Establish the application skeleton that every later ChessRemedy feature
depends on: a buildable, testable, lintable, typechecked, PWA-ready
React + TypeScript + Vite SPA with routing, theming, an application
shell, and an initial versioned Dexie database.

The deliverable satisfies the seven acceptance criteria of Feature 001:

- application starts locally
- production build succeeds
- tests run
- lint succeeds
- typecheck succeeds
- PWA foundation is functional
- database can open successfully

It must not implement any feature explicitly listed as a non-goal of
001 (game importing, Stockfish, puzzle generation, dashboard
implementation), and it must not pull in libraries that belong to those
later features (`chess.js`, `@lichess-org/chessground`, `stockfish`,
`recharts`, FSRS, etc.).

---

## 2. Scope

In scope (from `001-foundation.md`):

- React + TypeScript + Vite project scaffold
- Routing (single-page navigation between top-level sections)
- Styling (CSS reset, design tokens, light/dark themes, component
  CSS Modules)
- Testing stack (Vitest + Testing Library + happy-dom + fake-indexeddb
  per ADR-009)
- Linting (ESLint flat config, TypeScript-aware)
- Formatting (Prettier)
- PWA foundation (web manifest, service worker via `vite-plugin-pwa`)
- Application shell (header, primary navigation, content slot)
- Application configuration (app name, persistence schema version,
  default theme)
- Initial Dexie database (versioned v1 schema, openable end-to-end)

Out of scope (explicit non-goals of 001, or owned by later features):

- Chess logic (`chess.js`, FEN helpers) — Feature 003
- Chessboard component (`@lichess-org/chessground`) — Feature 002
- Stockfish worker, UCI, engine cache — Feature 005
- Game import, adapters for Chess.com / Lichess — Feature 006
- Game analysis pipeline — Feature 007
- Move classification, tactical detection, puzzle generation, puzzle
  training, SRS, statistics, dashboard, synchronization — Features
  008–015
- IndexedDB tables beyond the minimal v1 schema — deferred to Feature
  004 and beyond (added via Dexie version upgrades)

---

## 3. Open Decisions for Reviewer

Feature 001 is intentionally light on detail. The following choices are
not pinned by any spec or ADR. They are proposed here so the reviewer
can confirm or override them before implementation starts. The plan
should not be approved without explicit acknowledgement of these.

| # | Decision                         | Proposed choice                                                                  | Rationale                                                                                            |
|---|----------------------------------|----------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| D1 | Router library                   | `react-router-dom@^6`                                                             | Most widely used; integrates cleanly with Vite; data-router APIs available when needed later       |
| D2 | Styling approach                 | Plain CSS + CSS Modules (built into Vite) + CSS custom properties for theming    | No CSS framework dependency; small surface; satisfies AGENTS "avoid premature abstractions"          |
| D3 | PWA plugin                       | `vite-plugin-pwa` (Workbox under the hood)                                       | De facto Vite PWA solution; supports manifest + SW from one config                                   |
| D4 | Lint stack                       | ESLint 9 flat config + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y` | Flat config is the current ESLint standard; a11y plugin is required because the UI must work on mobile and not depend on hover |
| D5 | Format stack                     | Prettier 3 + `eslint-config-prettier`                                            | Prettier for formatting, ESLint for correctness, no overlap                                         |
| D6 | React version                    | React 19 + `react-dom` 19, paired with `@testing-library/react@^16`             | Approved V1 stack (ADR-009). React 19 + Testing Library 16.x is the V1 baseline; TL 16.x adds React 19 type inference including `onCaughtError` for React 19's error-boundary API, so `render`/`renderHook` type-check cleanly against React 19 without `@ts-expect-error`. |
| D7 | Dexie version                    | Dexie 4                                                                          | Current stable; clean versioned API                                                                  |
| D8 | Initial v1 Dexie schema content  | A single `settings` key/value table only                                          | Satisfies "database can open successfully"; leaves Feature 004 to add games/moves/etc. via v2 upgrade |
| D9 | Test environment                 | happy-dom default; jsdom opt-in per ADR-009                                      | ADR-009 says happy-dom is fast default, jsdom on-demand                                              |
| D10| PWA service worker in dev mode   | Disabled (`devOptions.enabled: false`)                                           | Keeps dev mode simple; SW behavior is validated in `npm run preview` after a production build         |
| D11| Theme persistence                 | Persist user choice (light/dark) in Dexie `settings` table; default follows `prefers-color-scheme` on first run | Foundation needs to demonstrate Dexie end-to-end; theme is the smallest durable user setting       |
| D12| App shell navigation items        | Home, Games, Analysis, Puzzles, Dashboard, Settings                              | Matches the six major V1 surfaces from PRODUCT.md §12. The four non-implemented pages (Games / Analysis / Puzzles / Dashboard) explicitly carry a visible **"Coming in Feature XXX"** badge so the user can tell at a glance which future feature will fill them in. |
| D13| Husky / lint-staged hooks        | Not included                                                                     | Out of scope for Foundation; can be added later without changing acceptance                          |

If the reviewer disagrees with any of D1–D13, the affected section(s)
below need to be re-written before implementation begins.

---

## 4. Existing Code to Reuse

The repository currently contains only:

- `AGENTS.md` — agent instructions and architectural rules
- `.gitignore` — covers `node_modules/`, `dist/`, `.env*`, `.vite/`,
  `coverage/`, `playwright-report/`, `test-results/`, `.DS_Store`,
  `*.tsbuildinfo`
- `.opencode/` — specs, ADRs, planner/researcher agents, opencode
  tooling config (unrelated to the application)

There is no `package.json`, no `src/`, no `index.html`, no Vite config.
This is a true greenfield. **Nothing existing is to be reused; the
plan is pure scaffold.**

The `.gitignore` already covers the artifacts Foundation produces, so
no changes to it are required. If implementation reveals gaps (e.g.
`.idea/`, `*.log`), they will be added as a small follow-up edit but
are not part of this plan's scope.

---

## 5. Files / Modules to Create or Modify

All paths are relative to the repository root.

### 5.1 Repository-root configuration

| Path                    | Purpose                                                                                  |
|-------------------------|------------------------------------------------------------------------------------------|
| `package.json`          | Scripts (dev, build, preview, test, test:browser, lint, lint:fix, typecheck, format, format:check), pinned dependency versions |
| `tsconfig.json`         | Solution-style TS config with project references to `tsconfig.app.json` and `tsconfig.node.json` |
| `tsconfig.app.json`     | Strict TS config for application source (`src/**`)                                      |
| `tsconfig.node.json`    | TS config for Vite/Vitest/Playwright config files and scripts                            |
| `vite.config.ts`        | Vite + `@vitejs/plugin-react` + `vite-plugin-pwa` configuration                          |
| `vitest.config.ts`      | (or merged into `vite.config.ts` per ADR-009) — test config, happy-dom env, alias `@` → `src` |
| `playwright.config.ts`  | Playwright 1.x config targeting `vite preview` build                                    |
| `eslint.config.js`      | ESLint 9 flat config                                                                     |
| `.prettierrc.json`      | Prettier config                                                                          |
| `.prettierignore`       | Files Prettier should skip (`dist`, `coverage`, `playwright-report`, etc.)              |
| `.editorconfig`         | Editor consistency (LF line endings, UTF-8, final newline)                              |
| `index.html`            | Vite entry HTML; theme init script runs before React mounts to prevent FOUC              |
| `README.md`             | Minimal developer quick-start (install, scripts, project structure)                      |
| `public/favicon.svg`    | SVG favicon (placeholder)                                                               |
| `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png` | PWA icons (placeholder raster images) |
| `.npmrc`                | Set `save-exact=false`; `engine-strict=true` requiring Node ≥ 20                         |

### 5.2 Application source (`src/`)

```
src/
├── main.tsx                       # React root; registers SW; mounts <App />
├── App.tsx                        # Provider composition: ThemeProvider + RouterProvider
├── vite-env.d.ts                  # Vite ambient types
│
├── app/
│   ├── router.tsx                 # createBrowserRouter with the route tree
│   └── routes.ts                  # Centralized route path constants
│
├── pages/
│   ├── HomePage.tsx               # Brief intro + links to other sections; composes <Hero />
│   ├── GamesPage.tsx              # Placeholder for Feature 006; shows "Coming in Feature 006" badge
│   ├── AnalysisPage.tsx           # Placeholder for Features 007/008; shows "Coming in Features 007/008" badge
│   ├── PuzzlesPage.tsx            # Placeholder for Features 010/011; shows "Coming in Features 010/011" badge
│   ├── DashboardPage.tsx          # Placeholder for Feature 014; shows "Coming in Feature 014" badge
│   ├── SettingsPage.tsx           # Composes <ThemePicker /> (real); other settings placeholders
│   ├── NotFoundPage.tsx           # 404 fallback
│   └── PlaceholderPanel.tsx       # Shared placeholder layout: heading + description + "Coming in Feature XXX" badge
│
├── components/
│   ├── ui/
│   │   ├── Button.tsx             # Small presentational button primitive (variants: primary / secondary / ghost)
│   │   ├── Button.module.css
│   │   ├── Hero.tsx               # HomePage hero block — title, tagline, primary CTA
│   │   ├── Hero.module.css
│   │   ├── ThemePicker.tsx        # SettingsPage theme picker section — wraps <ThemeToggle /> with label + helper text
│   │   └── ThemePicker.module.css
│   └── layout/
│       ├── AppShell.tsx           # Header + nav + <Outlet />; owns the layout grid
│       ├── AppShell.module.css
│       ├── Navigation.tsx         # <NavLink>-based primary nav, mobile-friendly
│       ├── Navigation.module.css
│       ├── ThemeToggle.tsx        # Light/dark toggle, persists to Dexie
│       └── ThemeToggle.module.css
│
├── hooks/
│   └── useTheme.ts                # Reads/writes theme via SettingsRepository; applies data-theme on <html>
│
├── infrastructure/
│   └── db/
│       ├── database.ts            # `export const db = new ChessRemedyDatabase()`; applies v1
│       ├── database.test.ts       # Verifies the database opens and `settings` table is queryable
│       ├── schema/
│       │   ├── v1.ts              # v1 schema: { settings: '&key' }
│       │   └── index.ts           # Re-exports `v1Schema`, future-proof shape
│       └── settings-repository.ts # Typed get/set/remove for the settings table (JSON-serialized values)
│
├── config/
│   └── app-config.ts              # APP_NAME, APP_VERSION, PERSISTENCE_SCHEMA_VERSION, DEFAULT_THEME
│
├── styles/
│   ├── tokens.css                 # CSS custom properties (colors, spacing, typography) for light and dark
│   ├── reset.css                  # Modern CSS reset
│   └── global.css                 # Imports reset + tokens; declares body/document baseline
│
└── test/
    ├── setup.ts                   # Registers fake-indexeddb/auto, MSW server hooks, jest-dom matchers, afterEach reset
    └── test-utils.tsx             # `renderWithProviders()` helper; wraps in MemoryRouter + ThemeProvider
```

Total: ~34 new files (was ~30; +3 ui components with CSS, +1 shared
PlaceholderPanel). Roughly half are config files at the repo root, the
rest are application modules organized by the four layers defined in
`ARCHITECTURE.md` §3 (Presentation / Application / Domain /
Infrastructure).

Notes:

- A `domain/` folder is intentionally **not** created yet. AGENTS.md
  requires domain code to be framework-agnostic, and there is no domain
  code in Foundation. Feature 003 will create the folder.
- The `infrastructure/db/` folder is the only infrastructure module in
  Foundation. Engine worker, sync adapters, and network adapters are
  added by later features.

---

## 6. Domain / Data Changes

### 6.1 Domain

**None.** Foundation establishes no business rules. The first domain
module is added by Feature 003 (chess rules via `chess.js`).

### 6.2 Data model (Dexie v1 schema)

The Architecture mandates IndexedDB via Dexie with versioned schemas.
Foundation defines the **v1** schema only. Future features add tables
through `db.version(N).stores({...})` upgrades — the pattern is
demonstrated by v1 itself.

```
db.version(1).stores({
  settings: '&key',
});
```

| Table      | Primary key | Purpose                                                                                            |
|------------|-------------|----------------------------------------------------------------------------------------------------|
| `settings` | `key`       | Single-row-per-key storage for app-level settings (theme, future user prefs). Values are JSON-serialized. |

Repository shape (in `settings-repository.ts`):

```ts
export interface Setting<T> {
  key: string;
  value: T;
}

export interface SettingsRepository {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}
```

This is the **only** persistence schema Foundation owns. It is
sufficient to satisfy the "database can open successfully" acceptance
criterion and to persist the theme setting (the smallest durable user
preference). Tables for games, moves, analyses, puzzles, reviews, SRS
state, jobs, and sync metadata will be introduced by their owning
features through Dexie version upgrades — see §11.

### 6.3 Application configuration constants

`src/config/app-config.ts` exports:

```ts
export const APP_NAME = 'ChessRemedy';
export const APP_VERSION = '0.1.0';            // bumped per release
export const PERSISTENCE_SCHEMA_VERSION = 1;  // must match the highest db.version() applied
export const DEFAULT_THEME: 'light' | 'dark' = 'light';
```

`PERSISTENCE_SCHEMA_VERSION` is the single source of truth for database
version; future features raise both the `db.version()` call and this
constant in lockstep.

---

## 7. UI Changes

All UI is new. There is no prior UI to modify.

### 7.1 Visual language

- **Design tokens.** All colors, spacing, radii, typography and shadows
  are declared as CSS custom properties in `styles/tokens.css` under
  `:root` (light) and `[data-theme="dark"]` (dark). No magic values in
  component CSS.
- **Themes.** Light/dark via a `data-theme` attribute on `<html>`, set
  by `useTheme`. Default on first run is `prefers-color-scheme`.
- **Reset.** `styles/reset.css` provides a modern reset (no opinionated
  component library).
- **Per-component CSS Modules.** Co-located `*.module.css` next to
  components; no global class names besides tokens.
- **Accessibility.** Color tokens meet WCAG AA contrast for body text in
  both themes. Interactive elements are ≥44px on touch viewports per
  AGENTS §13.

### 7.2 Application shell (`AppShell`)

```
+--------------------------------------------------+
| [Logo] ChessRemedy            Home Games Anal... | <- <Navigation />
+--------------------------------------------------+
|                                                  |
|                  <Outlet />                      |  <- routed page content
|                                                  |
+--------------------------------------------------+
```

- Header is sticky.
- Navigation uses `<NavLink>` so the active route is visually
  highlighted.
- Works at desktop, tablet and mobile widths. On mobile, the nav
  collapses to a horizontal scrollable list rather than a hamburger
  menu (keeps everything one tap away; consistent with AGENTS §13
  "essential functionality must not depend on hover").

### 7.3 Pages

- **HomePage** — short product description and the same nav links
  (duplicate of header for discoverability on mobile). The hero block
  (title, tagline, primary CTA) is extracted into a reusable
  `<Hero />` component in `components/ui/` so it can be reused on
  future surfaces and exercised directly through Vitest +
  Testing Library.
- **GamesPage, AnalysisPage, PuzzlesPage, DashboardPage** — rendered
  through a shared `PlaceholderPanel` component that shows a heading,
  a short description, and a visible **"Coming in Feature XXX"**
  badge naming the feature that will own the page:
  - `GamesPage` → "Coming in Feature 006 — Game Import"
  - `AnalysisPage` → "Coming in Features 007 / 008 — Game Analysis & Move Classification"
  - `PuzzlesPage` → "Coming in Features 010 / 011 — Puzzle Generation & Training"
  - `DashboardPage` → "Coming in Feature 014 — Dashboard"

  The badge makes each placeholder self-documenting rather than
  ambiguous, satisfying the D12 clarification.
- **SettingsPage** — actually functional in Foundation: composes a
  reusable `<ThemePicker />` component (in `components/ui/`) which in
  turn hosts the `<ThemeToggle />`. Other settings (engine strength,
  hint levels, etc.) are listed with the same
  "Coming in Feature XXX" badge style so the placeholder treatment is
  consistent across pages and settings rows.
- **NotFoundPage** — for unmatched routes.

### 7.4 Theme toggle

- Toggle control in the header (`ThemeToggle`).
- Also exposed on SettingsPage for discoverability.
- Cycles `light → dark → light`. System-preference mode is **not**
  exposed in Foundation UI to keep the toggle deterministic; the
  default on first run reads `prefers-color-scheme` and persists the
  resolved choice.

### 7.5 Pre-mount theme application

`index.html` contains a small inline script that, before React mounts,
sets `data-theme` on `<html>` based on:

1. a value previously persisted by this app in `localStorage` (read
   synchronously — localStorage is intentionally used **only** for the
   pre-mount hint), or
2. `window.matchMedia('(prefers-color-scheme: dark)')`.

Once `useTheme` mounts, it reads from Dexie (the source of truth) and
overwrites the localStorage hint. This avoids a flash of incorrect
theme.

The localStorage hint is a single key (`chessremedy:theme-hint`) used
exclusively for FOUC mitigation; it is not a primary store.

---

## 8. Infrastructure Changes

### 8.1 Build tooling

- Vite 6.x as the dev server and bundler.
- `@vitejs/plugin-react` for Fast Refresh and JSX.
- `vite-plugin-pwa` with Workbox for the service worker and web
  manifest generation.
- TypeScript 5.x, strict mode, `moduleResolution: "bundler"`,
  `verbatimModuleSyntax`, `noUncheckedIndexedAccess: true`.

### 8.2 Service worker / manifest

`vite-plugin-pwa` configured to:

- registerType: `'autoUpdate'`
- injectRegister: `'auto'`
- manifest: name, short_name, description, theme_color, background_color,
  display (`'standalone'`), start_url (`'/'`), scope (`'/'`), icons (the
  three placeholders in `public/icons/`)
- workbox: precache all built assets; runtime cache for nothing in
  Foundation (later features add runtime caching rules as needed)

SW is registered automatically when the production build is served via
`vite preview`. In `vite dev` the SW is disabled (see D10).

### 8.3 Database

- Dexie 4 with one versioned schema (`v1`) and one table (`settings`).
- `database.ts` exports a singleton `db` instance.
- Tests construct a fresh Dexie instance against `fake-indexeddb` via
  the shared test setup.

### 8.4 Tooling integrations

- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — Vite production build, emits `dist/` including
  service worker and manifest
- `npm run preview` — `vite preview` on the built artifacts (used by
  Playwright)
- `npm run test` — Vitest run (happy-dom + fake-indexeddb)
- `npm run test:watch` — Vitest watch mode
- `npm run test:browser` — Playwright run against `npm run preview`
- `npm run lint` — ESLint (no warnings allowed)
- `npm run lint:fix` — ESLint with `--fix`
- `npm run typecheck` — `tsc --noEmit` for both project references
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check

---

## 9. Dependencies

Versions are minimums consistent with the spec. ADR-009 fixes Vitest
4.x, Testing Library 16.x, happy-dom 20.x, fake-indexeddb 6.x, MSW 2.x
and Playwright 1.x. ADR-014 pins Chessground at `^10.1.1` but
**Chessground is NOT installed in Feature 001** — it is a dependency of
Feature 002.

### 9.1 Runtime dependencies

| Package                | Version    | Used by                                                       |
|------------------------|------------|---------------------------------------------------------------|
| `react`                | `^19`      | UI                                                            |
| `react-dom`            | `^19`      | UI                                                            |
| `react-router-dom`     | `^6`       | Routing (D1)                                                  |
| `dexie`                | `^4`       | IndexedDB wrapper                                             |

### 9.2 Dev dependencies

| Package                          | Version    | Purpose                                                |
|----------------------------------|------------|--------------------------------------------------------|
| `typescript`                     | `^5`       | Language                                               |
| `vite`                           | `^6`       | Bundler / dev server                                    |
| `@vitejs/plugin-react`           | `^4`       | React Fast Refresh / JSX                                |
| `vite-plugin-pwa`                | `^0.20`    | PWA manifest + SW (D3)                                  |
| `workbox-window`                 | `^7`       | (Optional) only if needed by app code; otherwise transitively pulled |
| `vitest`                         | `^4`       | Test runner (ADR-009)                                  |
| `@vitest/coverage-v8`            | `^4`       | Coverage (ADR-009)                                      |
| `@testing-library/react`         | `^16`      | Component testing (ADR-009)                             |
| `@testing-library/user-event`    | `^14`      | Realistic user events (ADR-009)                         |
| `@testing-library/jest-dom`      | `^6`       | Custom matchers                                         |
| `happy-dom`                      | `^20`      | Default DOM env (ADR-009)                               |
| `jsdom`                          | `^30`      | On-demand DOM env (ADR-009)                              |
| `fake-indexeddb`                 | `^6`       | IndexedDB in tests (ADR-009)                             |
| `msw`                            | `^2`       | Network mocking (ADR-009) — installed, used minimally in Foundation; primary consumers are Feature 006 |
| `@playwright/test`               | `^1`       | Browser-level integration (ADR-009)                     |
| `eslint`                         | `^9`       | Linter (D4)                                              |
| `typescript-eslint`              | `^8`       | TS rules for ESLint 9                                    |
| `eslint-plugin-react-hooks`      | `^5`       | Hook rules                                               |
| `eslint-plugin-jsx-a11y`         | `^6`       | Accessibility rules                                      |
| `eslint-config-prettier`         | `^9`       | Prettier/ESLint integration (D5)                         |
| `prettier`                       | `^3`       | Formatter (D5)                                            |
| `@types/react`                   | `^19`      | React types                                               |
| `@types/react-dom`               | `^19`      | React DOM types                                           |
| `@types/node`                    | `^20`      | Node types for vite.config / playwright                  |

Storybook is deferred per ADR-009.

No dependency shall be added that belongs to a later feature
(`chess.js`, `@lichess-org/chessground`, `stockfish`, `recharts`,
`ts-fsrs`, …). If a later feature discovers it needs a dependency
Foundation should have installed, the implementing feature adds it.

---

## 10. Tests

Foundation's tests establish the testing stack and prove the
acceptance criteria in code.

### 10.1 Test setup (`src/test/setup.ts`)

- Registers `fake-indexeddb/auto` so any test that imports Dexie gets
  a working IndexedDB.
- Extends `expect` with `@testing-library/jest-dom` matchers.
- Sets up an MSW server (`setupServer`) with `beforeAll` /
  `afterAll` / `afterEach` handlers. Foundation declares no handlers
  but the pattern is in place for Feature 006.
- Calls `indexedDB.deleteDatabase` (or equivalent fake-indexeddb reset)
  between tests so Dexie does not leak state.

### 10.2 Unit / component tests

- **`src/infrastructure/db/database.test.ts`** — opens the database
  and asserts:
  - `db.isOpen()` returns `true`.
  - `db.tables` contains exactly `['settings']`.
  - A round-trip `set('theme', 'dark')` / `get('theme')` returns
    `'dark'`.
  - This satisfies the "database can open successfully" acceptance
    criterion as a runnable check.
- **`src/infrastructure/db/settings-repository.test.ts`** — covers the
  `get`/`set`/`remove` serialization contract (numbers, strings,
  booleans, objects; non-JSON values rejected or stringified).
- **`src/components/layout/AppShell.test.tsx`** — renders the shell,
  asserts the brand name appears and the six nav links are present.
- **`src/components/layout/Navigation.test.tsx`** — clicking each link
  activates the matching route (using `MemoryRouter`).
- **`src/components/layout/ThemeToggle.test.tsx`** — initial value
  reflects `data-theme` on `<html>`; clicking flips attribute and
  persists to Dexie.
- **`src/hooks/useTheme.test.tsx`** — direct hook test against a
  `renderHook` + MemoryRouter + Dexie fixture; verifies first-run
  default, explicit override, and persistence across remounts.

### 10.3 Browser-level tests (Playwright)

A single Playwright spec validates the production build end-to-end:

- `tests/e2e/app-shell.spec.ts` — boots `vite preview`, navigates to
  `/`, asserts the heading and the nav links; clicks the Games link
  and asserts the placeholder page renders; toggles theme and
  reloads, asserts the theme persists.
- `tests/e2e/pwa.spec.ts` — loads the app, asserts
  `navigator.serviceWorker.controller` becomes truthy; asserts the
  manifest link is present and has a parseable JSON payload with
  `name`, `start_url`, `display: standalone`, and at least one icon.

### 10.4 What Foundation does NOT test

- No chess logic tests — none exists in Foundation.
- No domain tests — Foundation has no domain code.
- No engine tests — Feature 005.
- No game import tests — Feature 006.

---

## 11. Migration Considerations

### 11.1 In-Foundation migrations

**None.** v1 is the initial schema. There are no users with prior
schemas to migrate from.

### 11.2 Forward-compatibility pattern (the only durable design
decision for the database)

`src/infrastructure/db/database.ts` applies versions by importing and
chaining `db.version(N).stores({...}).upgrade(tx => {...})` calls.
Foundation installs the pattern as:

```ts
// src/infrastructure/db/database.ts
import Dexie, { type Table } from 'dexie';
import { v1Schema } from './schema/v1';
import type { SettingsRepository } from './settings-repository';

class ChessRemedyDatabase extends Dexie {
  settings!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('chessremedy');
    // Future: v1Schema, v2Schema, ... chained here in order.
    v1Schema(this);
  }
}

export const db = new ChessRemedyDatabase();
```

Each version file (`schema/v1.ts`) exports a function that takes the
`Dexie` instance and calls `.version(N).stores({...})`. Future features
add `schema/v2.ts`, etc., and append a call to the constructor.

`PERSISTENCE_SCHEMA_VERSION` in `config/app-config.ts` is the human-
readable mirror of the highest applied version and must be bumped in
the same commit that adds a new `schema/vN.ts`.

This pattern is what Feature 004 (Local Game Storage) will follow to
add the `games`, `moves`, `import_jobs` and `analysis_jobs` tables via
a v2 upgrade without Foundation needing to predict them.

### 11.3 Future-version contracts

The acceptance criterion "database can open successfully" is a
Foundation concern. The first time a future migration changes a
table, that feature is responsible for:

- Adding `schema/vN.ts` with both the new table definitions and an
  `upgrade(tx => {...})` callback if data needs transformation.
- Calling the version from the constructor.
- Bumping `PERSISTENCE_SCHEMA_VERSION`.
- Adding a test that opens a database at the prior version, runs the
  migration, and asserts the expected post-migration shape.

Foundation's tests do not need to test migrations because no migration
exists yet; the pattern is in place for the feature that adds the
first real one (Feature 004).

---

## 12. Implementation Phases (incremental order)

Each phase ends with a green build / green test run. No phase depends
on code from a later phase.

### Phase 1 — Project bootstrap
- `package.json`, root `tsconfig*.json`, `vite.config.ts`,
  `index.html`, `src/main.tsx`, `src/App.tsx` rendering a placeholder
  heading.
- `npm run dev` serves the app; `npm run build` succeeds; `npm run
  typecheck` succeeds.

### Phase 2 — Lint + format
- `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  `.editorconfig`.
- `npm run lint` and `npm run format:check` pass on the Phase 1 code.

### Phase 3 — Testing stack
- `vitest.config.ts`, `src/test/setup.ts`, `src/test/test-utils.tsx`.
- Add a trivial App-renders test to prove the runner works.
- `npm run test` is green.

### Phase 4 — Styling and theming
- `styles/tokens.css`, `styles/reset.css`, `styles/global.css`.
- `hooks/useTheme.ts`, `components/layout/ThemeToggle.tsx` (+ CSS).
- Inline pre-mount theme script in `index.html`.
- `npm run test` covers the toggle behavior.

### Phase 5 — Routing and app shell
- `app/router.tsx`, `app/routes.ts`, `components/layout/AppShell.tsx`,
  `components/layout/Navigation.tsx`, `pages/*`.
- `npm run test` covers nav and route activation; Playwright spec
  covers the production preview.

### Phase 6 — Dexie database
- `infrastructure/db/schema/v1.ts`, `database.ts`,
  `settings-repository.ts`, `database.test.ts`.
- Wire the theme setting through the repository (replacing the
  localStorage hint used only for FOUC).
- The database-open test passes.

### Phase 7 — PWA
- Add `vite-plugin-pwa` to `vite.config.ts`.
- Add placeholder icons to `public/icons/`.
- Wire `public/favicon.svg` and update `index.html`.
- Playwright `pwa.spec.ts` validates SW registration and manifest.
- `npm run build && npm run preview` shows a registered SW.

### Phase 8 — Polish
- `README.md` quick-start.

### Phase 9 — Polish
- Run the full quality gate (`lint`, `typecheck`, `test`,
  `test:browser`, `build`) and capture the output as the acceptance
  evidence.

---

## 13. Risks

| # | Risk                                                                                                                  | Likelihood | Impact | Mitigation                                                                                                       |
|---|------------------------------------------------------------------------------------------------------------------------|------------|--------|------------------------------------------------------------------------------------------------------------------|
| R1 | Spec is minimal; reviewer may disagree with one of D1–D13                                                              | Medium     | Medium | §3 lists every decision explicitly so they can be approved or replaced before code is written                   |
| R2 | `vite-plugin-pwa` Service Worker behavior in dev vs preview differs                                                   | High       | Low    | D10 disables SW in dev; Playwright runs against `vite preview` after `npm run build`                              |
| R3 | FOUC on theme persistence                                                                                              | Medium     | Medium | Inline pre-mount script reads localStorage hint and `prefers-color-scheme` before React mounts                   |
| R4 | Foundation pre-declares tables that later features want differently                                                    | Low        | High   | Foundation only declares `settings`. All other tables are added by their owning features via `db.version(N).upgrade(...)` |
| R5 | React 19 + react-router-dom v6 compatibility                                                                          | Low        | Medium | React Router v6 supports React 18+; verify in Phase 5's first test run                                          |
| R6 | Vitest 4.x or Testing Library 16.x not yet GA at implementation time                                                  | Low        | Medium | Today is 2026-08-31; both should be GA. If a chosen version is unavailable, fall back to latest stable and flag a follow-up ADR |
| R7 | ESLint 9 flat config ecosystem drift                                                                                  | Low        | Low    | Pin via `package.json`; CI runs `lint` exactly the same as local                                                  |
| R8 | PWA icons are placeholders; Lighthouse PWA category will not fully pass                                                 | High       | Low    | Acceptance criterion is "PWA foundation is functional," not "Lighthouse PWA 100." Real artwork is a follow-up ticket |
| R9 | Husky / lint-staged omitted, so contributors can commit unlinted code                                                  | Medium     | Low    | Out of scope for Foundation; document in README that pre-commit hooks are a separate follow-up                    |
| R10| `index.html` inline theme script reads localStorage, which is also used by other features later                       | Low        | Low    | Use a dedicated, namespaced key (`chessremedy:theme-hint`) and document it as FOUC-only, not authoritative          |

---

## 14. Acceptance Criteria

Each acceptance criterion from `001-foundation.md` is mapped to a
specific, runnable verification.

| Spec criterion                          | Concrete check                                                                                                                                                                                  |
|------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Application starts locally               | `npm run dev` serves at http://localhost:5173, the home page renders, the navigation links are visible, theme toggle works.                                                                     |
| Production build succeeds                | `npm run build` exits 0 and produces `dist/` containing `index.html`, hashed JS/CSS, `manifest.webmanifest` and `sw.js` (or equivalent Workbox output).                                         |
| Tests run                                | `npm run test` exits 0; `npm run test:browser` exits 0.                                                                                                                                          |
| Lint succeeds                            | `npm run lint` exits 0 with zero errors and zero warnings.                                                                                                                                       |
| Typecheck succeeds                       | `npm run typecheck` exits 0 for both `tsconfig.app.json` and `tsconfig.node.json`.                                                                                                              |
| PWA foundation is functional             | After `npm run build && npm run preview`, the Playwright `pwa.spec.ts` passes: `navigator.serviceWorker.controller` is truthy and the served manifest has `name`, `start_url`, `display: 'standalone'`, and at least one icon ≥192px. |
| Database can open successfully           | `src/infrastructure/db/database.test.ts` passes: `db.isOpen()` is true, `db.tables` equals `['settings']`, a `set`/`get` round-trip returns the same value.                                    |

Additional non-spec verifications captured for completeness:

- Theme toggle persists across a full page reload (Playwright
  `app-shell.spec.ts`).
- Navigating between routes does not require a full reload (router
  uses client-side transitions).
- Lighthouse "Installable" check passes against `vite preview` (the
  lighter of the two PWA categories — sufficient for "PWA foundation
  is functional").
- No `chess.js`, `@lichess-org/chessground`, `stockfish`, `recharts`,
  `ts-fsrs`, or game-import adapters appear in `package.json`.

---

## 15. Verification Commands

Run from the repository root after implementation completes.

```bash
# 1. Install
npm ci

# 2. Static checks
npm run lint
npm run typecheck
npm run format:check

# 3. Unit / component tests
npm run test

# 4. Production build
npm run build

# 5. Browser integration tests (against the production build)
npm run preview &        # vite preview serves the built app
npm run test:browser
# stop the preview server after tests complete

# 6. Smoke test the dev server (manual)
npm run dev
# open http://localhost:5173 — confirm HomePage renders, theme toggle works, nav links route correctly

# 7. Verify PWA artifacts on disk
ls dist/manifest.webmanifest
ls dist/sw.js
ls dist/assets/ | head

# 8. Verify the database-open check programmatically
npm run test -- src/infrastructure/db/database.test.ts

# 9. Confirm no forbidden dependencies snuck in
node -e "const p=require('./package.json'); const forbid=['chess.js','@lichess-org/chessground','stockfish','recharts','ts-fsrs']; const all={...p.dependencies,...p.devDependencies}; for(const f of forbid){ if(all[f]){console.error('forbidden dep:',f); process.exit(1);} }"
```

If every command exits 0 and the manual smoke test confirms the
expected UI behavior, Feature 001 is complete.

---

## 16. Notes for the Reviewer

- This plan deliberately does **not** install `chess.js` or
  `@lichess-org/chessground`. They are owned by Features 002 and 003.
  Adding them in Foundation would couple Foundation to later feature
  decisions.
- The Dexie v1 schema is intentionally minimal (one table). Feature
  004 introduces the real storage tables through a v2 migration. This
  keeps Foundation's database contract minimal and prevents
  premature decisions on storage shape.
- The pre-mount inline script in `index.html` reads localStorage as a
  FOUC hint only; Dexie is the source of truth for theme. This is a
  deliberate, narrowly-scoped dual read, documented inline so the
  pattern is not copy-pasted to other settings later.
- ADR-009 and ADR-014 were both respected: the testing stack and the
  Chessground version pin are both honored — the latter vacuously, by
  not adding Chessground at all in Foundation. ADR-009's "Non-V1
  deferrals" line for Storybook also stands: Foundation does not
  install Storybook.
- If any decision in §3 is rejected, the affected phase(s) in §12 must
  be revised before implementation begins.
