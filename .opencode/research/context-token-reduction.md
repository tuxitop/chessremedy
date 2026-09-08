# Report — Reducing session context & token usage in ChessRemedy sessions

Status: informational (not a product decision; no feature scope change).
Date: 2026-09-08. Sources: opencode docs fetched 2026-09-08
(https://opencode.ai/docs/*) and the opencode plugin SDK source
(github.com/anomalyco/opencode, `packages/plugin/src/index.ts`).

## 0. What actually costs tokens today (observed)

- Long agentic runs accumulate many tool outputs (large read windows,
  `vitest`/`eslint` tails, full-file diffs) that stay in context until
  compaction.
- The repo's docs are large but already disciplined: default-context files
  are ~859 lines (`AGENTS.md` + `.opencode/DECISIONS.md` +
  `.opencode/CONTEXT-MAP.md` + `.opencode/specs/ARCHITECTURE.md`), and
  `AGENTS.md` already mandates progressive disclosure. The real bulk lives
  in feature specs/plans (`.opencode/specs` ≈ 724 KB, `.opencode/plans`
  ≈ 400 KB; e.g. `005-stockfish.md` 753 lines, `008-game-analysis.md`
  732 lines) — cheap when only the required feature is read, expensive when
  a task pulls several.
- Plan 14's premise was "this session grew too large", so process /
  compaction mechanics matter more here than doc bulk alone.

## 1. Levers already in opencode (no plugins, no code changes)

| Lever | What it does | Effort |
|---|---|---|
| `compaction.auto` (default true) | Auto-compacts when the window is full. | on by default |
| `compaction.prune` (default false) | Removes old tool outputs to save tokens — the single biggest win for engine/e2e-heavy sessions. | 1-line config (applied) |
| `compaction.reserved` | Token buffer so compaction never overflows. | tune if pruning feels aggressive |
| `/compact` (`ctrl+x c`) | Manual summarise-now instead of waiting. | habit |
| `/new` / `/sessions` / `--continue` / `--fork` | Fresh session with continuity. | habit |
| `/undo`, `/redo` | Revert last message + tool calls and retry cheaper (git snapshot-backed). | habit |
| Per-agent/command `model`, `temperature`, `steps`, reasoning variants; top-level `small_model` | Cheaper/faster models for sub-tasks; cap agentic iterations. | config |
| `opencode stats` | Measure actual token/cost by day/model/tool → focus where spend really is. | habit |

Applied as Phase 1: project `opencode.json` (this directory) now sets
`compaction.prune: true`.

Docs: opencode.ai/docs/config/#compaction, /tui, /cli, /agents.

## 2. Levers: subagents & skills (biggest structural win)

- Subagents isolate context: the `task` tool runs work in child sessions;
  only the subagent's final message returns to the primary context. This
  repo already ships specialised agents (`explore`, `general`, `architect`,
  `planner`, `researcher`, `reviewer`, `spec-auditor`, `tester`,
  `chess-reviewer`).
- Applied as Phase 1: `.opencode/commands/research.md` and
  `.opencode/commands/explore.md`, both forced `subtask: true`
  (documented: "will NOT pollute your primary context" —
  opencode.ai/docs/commands/#subtask).
- Skills load on demand: a skill contributes only its name + description
  until invoked. Convert rarely-needed but large procedures (full execution
  gate steps, spec-writing rituals) into `.opencode/skills/<name>/SKILL.md`.
  `AGENTS.md` stays for always-on policy. This repo has no `.opencode/skills`
  yet (a global `graphify` skill exists).
- Mark helper subagents `hidden: true` to run only via the task tool; scope
  `permission.task` / `subagent_depth` (default 1 already).

Docs: opencode.ai/docs/agents, /commands/#subtask, /skills, /tools/#skill.

## 3. Levers: plugins

### 3a. What a plugin can do (documented)
- Hooks/events: `tool.execute.before/after`, `shell.env`, `command.executed`,
  file/session/permission/message events, and `experimental.session.compacting`
  which can inject context into (or fully replace) the compaction summary.
- Custom tools that override built-ins (same-name precedence), e.g. wrap
  `read` to only return targeted slices.
- SDK `session.prompt({ noReply: true })` injects context without triggering
  an AI response.

### 3b. Community plugins relevant to context (opencode.ai/docs/ecosystem)
- `opencode-dynamic-context-pruning` — pruning obsolete tool outputs.
- `opencode-skillful` — lazy-loads prompt snippets via a plugin.
- `opencode-type-inject`, `opencode-vibeguard` (secret redaction; note the
  global `~/.config/opencode/opencode.json` inlines provider API keys — a
  redaction plugin would keep those out of context/logs).
- No official registry; npm + ecosystem page is the channel.

### 3c. What a plugin can't do yet (documented) — honesty
- No docs-site hook to actively delete/trim past messages mid-session;
  trimming is only available at compaction time.
- The richer hooks (`chat.params`, `chat.message`, `tool.definition`,
  `experimental.chat.messages.transform`, `experimental.chat.system.transform`,
  `experimental.provider.small_model`) exist in the `@opencode-ai/plugin` SDK
  source but are undocumented on the docs site — treat as
  experimental/volatile.

### Recommended plugin path (low-risk first)
1. Built-in `compaction.prune` (done — no plugin needed).
2. Later: a tiny project plugin injecting ChessRemedy invariants into the
   `experimental.session.compacting` context, only if compaction drops
   something important.
3. Evaluate `opencode-dynamic-context-pruning` from the ecosystem before
   writing custom code.

Docs: opencode.ai/docs/plugins, /ecosystem, /sdk/#sessions.

## 4. Doc / repo fixes for ChessRemedy

| Fix | Why | Effort |
|---|---|---|
| Project `opencode.json` with `compaction.prune: true` (applied) | Biggest cheap lever for engine/e2e-heavy sessions. | done |
| Trim `ARCHITECTURE.md` (455 lines, in every default context) to a decision-pointer digest | Cuts the constant per-session floor. | medium |
| De-duplicate cross-doc restatements (`winning_material`, `DETECTION_VERSION`, thresholds repeated across `features/010`, `ADR-026`, `research/tactical-detection.md`, domain docs) | Reduces the "load several feature docs" case. | medium |
| Keep plans/handoffs short; commit + `/new` + resume with `--continue` | Directly addresses the root cause (plan 14). | habit |
| Full execution gate as a skill/command body instead of every-task prose | AGENTS can say "run the verify command". | small |
| Standardise on diff/targeted output (applied to `AGENTS.md` "Output discipline") | Cuts output tokens directly. | done |
| Re-scope/remove the global `graphify` plugin for ordinary sessions | Every loaded plugin adds description tokens; keep it for graph queries only. | tiny |
| Move `.opencode/node_modules` (63 MB, git-ignored, plugin deps) out of the tree | Tidy-up only; not a token issue. | optional |

## 5. Recommended phased action set

**Phase 1 (applied 2026-09-08):**
1. Project `opencode.json` with `compaction.prune: true`.
2. `.opencode/commands/research.md` and `.opencode/commands/explore.md`
   forced `subtask: true`.
3. `AGENTS.md` "Output discipline" section (deltas, `file:line`, summarised
   subagent results, narrow-first gating, session boundaries).

**Phase 2 (small):**
4. Add a verify-gate skill; trim `ARCHITECTURE.md`; de-duplicate the
   detection-version/objective constants across 010/ADR-026/research.
5. Try `opencode-dynamic-context-pruning`; measure with `opencode stats`.

**Phase 3 (optional / experimental):**
6. Write a project plugin using the (undocumented but present)
   `experimental.chat.messages.transform` / compaction hooks to trim
   aggressively or pin critical invariants at compaction — only if Phases
   1–2 don't suffice, and flagged as relying on a non-docs API.

Each change is independently revertible and measurable (`opencode stats`,
per-session token deltas).
