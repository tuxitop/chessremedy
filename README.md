# ChessRemedy

Local-first chess training. Import your games, run Stockfish locally,
and convert mistakes into personalised puzzles.

> **Status:** V1 is under active development. This commit ships the
> **Foundation** feature (see
> [`.opencode/specs/features/001-foundation.md`](.opencode/specs/features/001-foundation.md)).
> Subsequent features (chessboard, game import, Stockfish analysis,
> puzzles, FSRS, statistics, dashboard, sync) are tracked by the
> spec workspace, not by this README.

---

## Quick start

```bash
# 1. Install (Node ≥ 20)
npm ci

# 2. Run the dev server
npm run dev
# → http://localhost:5173

# 3. Build for production
npm run build

# 4. Preview the production build (used by Playwright)
npm run preview
# → http://localhost:4173
```

## Scripts

| Command                | What it does                                    |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Vite dev server with HMR                        |
| `npm run build`        | Type-check then production build to `dist/`     |
| `npm run preview`      | Serve the production build (used by Playwright) |
| `npm run test`         | Vitest unit + component tests                   |
| `npm run test:watch`   | Vitest in watch mode                            |
| `npm run test:browser` | Playwright E2E tests against `npm run preview`  |
| `npm run lint`         | ESLint (flat config)                            |
| `npm run lint:fix`     | ESLint with `--fix`                             |
| `npm run typecheck`    | `tsc -b --noEmit` over both project references  |
| `npm run format`       | Prettier write                                  |
| `npm run format:check` | Prettier check (used in CI)                     |

## Project layout

```
src/
  app/            # Routing & route-path constants (Application layer)
  pages/          # Routed pages (Presentation)
  components/
    layout/       # AppShell, Navigation, ThemeToggle
    ui/           # Button, Hero, ThemePicker (reusable primitives)
  hooks/          # Cross-component React hooks (useTheme)
  infrastructure/ # Cross-cutting adapters (db)
    db/           # Dexie database + schema versioning + settings repo
  styles/         # tokens.css, reset.css, global.css
  test/           # Vitest setup + renderWithProviders helper
  config/         # App-wide constants
```

The four layers defined in `.opencode/specs/ARCHITECTURE.md` map as:

- **Presentation** — `src/pages/`, `src/components/`
- **Application** — `src/app/`
- **Domain** — _not yet created; Feature 003 will introduce `src/domain/`_
- **Infrastructure** — `src/infrastructure/`

## Architecture decisions

- React 19 + TypeScript 5 + Vite 6 + react-router-dom 6.
- IndexedDB via Dexie 4 with versioned schemas (currently v1, just the
  `settings` table).
- Theme is persisted in Dexie (`settings` table). A `localStorage` hint
  is used only to prevent FOUC before React mounts.
- PWA via `vite-plugin-pwa` (Workbox). Service worker is disabled in
  `vite dev` and validated via `vite preview`.
- All testing follows ADR-009: Vitest + Testing Library + happy-dom
  (default) / jsdom (on-demand) + fake-indexeddb + MSW (installed by
  its consumer feature) + Playwright. Exact versions follow the
  Dependency policy in `AGENTS.md` (latest stable).

See `.opencode/specs/decisions/` for the full set of accepted ADRs.

## Forbidden dependencies

Foundation must not install `chess.js`, `@lichess-org/chessground`,
`stockfish`, `recharts`, or `ts-fsrs`. These belong to later features.
A guard script is documented in `.opencode/plans/001-foundation.md` §15.

## License

ChessRemedy is licensed under the **GNU General Public License v3 or
later** ([GPL-3.0-or-later](./LICENSE)). See [ADR-027](./.opencode/specs/decisions/ADR-027-license-gpl.md)
for the rationale (the relicense was forced by adopting
`@lichess-org/pgn-viewer` for the move-list renderer).

## Spec workspace

The canonical product, architecture, decision and research documents
live in `.opencode/specs/`. AGENTS.md (at the repo root) is the
authoritative set of agent conventions.
