# ChessRemedy

Local-first chess training. Import your games, run Stockfish locally,
and convert mistakes into personalised puzzles.

> **Status:** **v1.0.0 released.** All V1 roadmap features (001–016) and
> the follow-up refinements 017–019 are implemented. The canonical
> feature list lives in [`.opencode/specs/features/`](.opencode/specs/features/);
> see [`CHANGELOG.md`](./CHANGELOG.md) for the release summary.

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
  app/            # Router, routes, bootstrap (Application layer)
  pages/          # Routed pages (Presentation)
  components/
    analysis/     # Analysis board + move list surfaces
    chessboard/   # Chessground wrapper (ADR-002/014/030)
    dashboard/    # Dashboard widgets
    games/        # Library, review, puzzle and set surfaces
    home/         # Home page widgets
    layout/       # AppShell, Navigation, ThemeToggle
    puzzles/      # Puzzle board + training controls
    sync/         # Sync status + settings
    ui/           # Reusable primitives (Button, Hero, dialogs…)
  domain/         # Pure domain logic (no React/DB/Worker imports)
    analysis/ chess/ gameLibrary/ import/ puzzle/ statistics/
    sync/ tactics/ training/
  hooks/          # Cross-component React hooks
  infrastructure/ # Adapters (Dexie, engine, providers, sync…)
    analysis/ db/ engine/ home/ import/ providers/ puzzles/
    statistics/ sync/ tactics/ training/
  presentation/   # View models / mappers per surface
  styles/         # tokens.css, reset.css, global.css
  test/           # Vitest setup + renderWithProviders helper
  config/         # App-wide constants (incl. APP_VERSION, schema version)
```

The four layers defined in `.opencode/specs/ARCHITECTURE.md` map as:

- **Presentation** — `src/pages/`, `src/components/`
- **Application** — `src/app/`
- **Domain** — `src/domain/` (pure TypeScript on `chessops`)
- **Infrastructure** — `src/infrastructure/`

## Architecture decisions

- React 19 + TypeScript 6 + Vite 8 + react-router-dom 7.
- IndexedDB via Dexie 4 with versioned, additive schemas (currently
  **v12**: settings, games, import jobs, analyses + analysis jobs, the
  FEN-keyed engine cache, analysis summaries, puzzle candidates, puzzles,
  puzzle attempts, training sets/cycles, and sync metadata). New versions
  chain in `src/infrastructure/db/schema/`.
- Chess rules/state on `chessops`; the board is our own wrapper around
  `@lichess-org/chessground`; Stockfish runs in a Web Worker (ADR-004).
- Theme is persisted in Dexie (`settings` table). A `localStorage` hint
  is used only to prevent FOUC before React mounts.
- PWA via `vite-plugin-pwa` (Workbox). Service worker is disabled in
  `vite dev` and validated via `vite preview`.
- All testing follows ADR-009: Vitest + Testing Library + happy-dom
  (default) / jsdom (on-demand) + fake-indexeddb + MSW + Playwright.
  Exact versions follow the Dependency policy in `AGENTS.md` (latest
  stable).

See `.opencode/specs/decisions/` for the full set of accepted ADRs.

## Optional: Dropbox sync

Feature 016 can back up and sync your data across devices through your own
Dropbox account. Sync is **optional** — the app is fully usable without it.

1. Create a Dropbox app (Scoped access, **App folder** access).
2. On the app's **Permissions** tab, enable the scopes the sync uses:
   - `files.metadata.read` — read metadata / list the app folder
   - `files.content.read` — download the sync file
   - `files.content.write` — upload the sync file
3. Copy the app's **App key** into `.env.local` as `VITE_DROPBOX_APP_KEY`
   (see `.env.example`). The app key is public; PKCE means no client secret is
   ever needed or stored.
4. Register the OAuth redirect URI as `<your-origin>/settings`.
5. In the app, open **Settings → Synchronization** and connect Dropbox.

Scopes are baked into the access token at authorization time. After changing
the Permissions tab, **Disconnect** and **Connect** again so the new token
carries the added scopes.

The same panel also offers provider-free **Export backup** / **Import backup**
using the gzipped sync envelope (ADR-016).

## Hosting on GitHub Pages

The app is a static SPA and deploys to GitHub Pages automatically. The workflow
`.github/workflows/deploy-pages.yml` builds and publishes on every push to
`main` (and can be run manually from the Actions tab).

One-time setup in the GitHub repository:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**: name `VITE_DROPBOX_APP_KEY`, value your Dropbox app key. (It is
   public and safe to embed; never add a client secret.)
3. In the Dropbox app console, register the redirect URI for the deployed site:
   `https://<owner>.github.io/<repo>/settings`
   (for this repository: `https://tuxitop.github.io/chessremedy/settings`).
   Keep the local `http://localhost:5173/settings` URI as well.

The site is published at `https://<owner>.github.io/<repo>/`. If the repository
is renamed, update `BASE_PATH` in the workflow (and the redirect URI).

Notes:

- Project Pages are served from a sub-path, so the build uses Vite's `base`
  (`BASE_PATH`). Local `npm run dev` / `npm run preview` keep `base = '/'`.
- `BASE_PATH` is baked in at build time; routing, the PWA manifest/scope, the
  service worker, and the Dropbox redirect all follow it.
- GitHub Pages does not send COOP/COEP headers, so `crossOriginIsolated` is
  `false` and the app uses the single-threaded Stockfish build. Everything works;
  multi-threaded search is only available when those headers are present.
- SPA deep links/refreshes work because the workflow publishes `index.html` as
  `404.html` and the service worker uses an `index.html` navigation fallback.

## Dependency policy

Dependencies follow the policy in `AGENTS.md`: latest stable by default,
licence-compatible with GPL-3.0-or-later (ADR-027), with a new ADR for any
new copyleft dependency. `@lichess-org/chessground` is pinned to the 10.x
range (ADR-014). `ts-fsrs` is intentionally **not** a V1 dependency: V1
trains puzzles with cycle-based tactical training, not an individual
scheduler (ADR-031).

## License

ChessRemedy is licensed under the **GNU General Public License v3 or
later** ([GPL-3.0-or-later](./LICENSE)). See [ADR-027](./.opencode/specs/decisions/ADR-027-license-gpl.md)
for the rationale (the relicense was forced by adopting
`@lichess-org/pgn-viewer` for the move-list renderer).

## Spec workspace

The canonical product, architecture, decision and research documents
live in `.opencode/specs/`. AGENTS.md (at the repo root) is the
authoritative set of agent conventions.
