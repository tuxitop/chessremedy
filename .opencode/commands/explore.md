---
description: Explore the codebase in an isolated subagent (keeps this session small)
agent: explore
subtask: true
---

> Run codebase exploration as an isolated subagent so its searches and file
> reads do not pollute the primary session context (`subtask: true`). Only the
> subagent's final summary returns to this conversation.

Explore the ChessRemedy codebase to answer the given question. State the
desired thoroughness up front (quick / medium / very thorough).

Return only what the caller asked for, as a concise list of `file:line`
references with a one-line explanation each. Do not paste whole files back.
Do not modify files.
