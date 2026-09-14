# Changelog

All notable changes to ChessRemedy are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-14

First stable release. ChessRemedy is a local-first chess training SPA:
import your own games, analyse them with Stockfish in the browser, turn
mistakes and missed tactics into personalised puzzles, and train them in
cycle-based tactical sessions.

### Added

- **Foundation (001)** — React 19 + TypeScript + Vite SPA, routing, theming
  (light/dark), PWA shell, and the Dexie persistence layer.
- **Chessboard & chess interaction (002)** — a reusable
  `@lichess-org/chessground` wrapper (ADR-002/014/030) with mouse and touch
  interaction.
- **Chess/game domain (003)** — pure `chessops`-based domain model and
  deterministic fixtures.
- **Local game storage (004)** — IndexedDB (Dexie) with versioned, additive
  schemas, settings persistence, and deletion cascades.
- **Stockfish engine (005)** — Stockfish WASM running in a Web Worker with a
  FEN-keyed analysis cache (ADR-004/018).
- **Live analysis board (006)** — play/analyse a position with engine
  evaluation, best lines, and a shared analysis-board surface (ADR-033).
- **Game import & library (007)** — import from Lichess and Chess.com, plus
  PGN; a filterable, searchable game library.
- **Game analysis & review (008)** — full-game Stockfish analysis with a
  resumable queue and per-ply review.
- **Classification & accuracy (009)** — move classification and accuracy
  metrics (ADR-023/024).
- **Tactical detection (010)** — detection of missed tactics and blunders
  with verified-missed-tactic exclusivity.
- **Tactical puzzle generation (011)** — puzzle candidates and generated
  puzzles sourced from the user's own games.
- **Puzzle training (012)** — a solve board with hints, timers, and
  immutable per-presentation attempt rows.
- **Tactical training cycles (013)** — Woodpecker-style cycle training with
  training sets and cycles (ADR-031).
- **Game history & statistics (014)** — analysis history, insights, and
  per-analysis summaries.
- **Dashboard (015)** — overview of training progress and statistics
  (ADR-010 charts).
- **Synchronization (016)** — optional Dropbox sync plus provider-free
  gzipped export/import backups (ADR-008/015/016/017).
- **W1 UI/UX refinements (017)** — palette/design refresh, navigation and
  responsive polish.
- **W6 home page (018)** — redesigned home page with recent-window stats.
- **Timed training sessions (019)** — optional timed session mode for
  training cycles.

### Technical

- Chess rules/state on `chessops`; board on `@lichess-org/chessground`
  (10.x, ADR-014); Stockfish WASM in a Web Worker.
- Persistence schema **v12** (additive migrations in
  `src/infrastructure/db/schema/`).
- Licensed under **GPL-3.0-or-later** (ADR-027).

[1.0.0]: https://github.com/tuxitop/chessremedy/releases/tag/v1.0.0
