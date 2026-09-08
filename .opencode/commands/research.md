---
description: Research a question in an isolated subagent (keeps this session small)
agent: researcher
subtask: true
---

> Run research as an isolated subagent so its tool calls and reading do not
> pollute the primary session context (`subtask: true`). Only the subagent's
> final report returns to this conversation.

Research the given question using authoritative sources (see
`.opencode/agents/researcher.md` for the evidence hierarchy and the
research areas that matter to ChessRemedy).

Start from `.opencode/CONTEXT-MAP.md` (research column) and existing
`.opencode/specs/research/` material. Load deeper documents only as the
question requires — do not read the whole documentation tree.

Return a tight, structured report:

- question
- findings
- evidence (with source URLs / file paths)
- limitations
- recommendation
- implications for ChessRemedy

Do not modify application source code. Only write conclusions into
`.opencode/specs/research/` when explicitly asked.
