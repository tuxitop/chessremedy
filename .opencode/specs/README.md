# ChessRemedy Specification Workspace

Each document type has one clear responsibility. Read order for a
feature task is defined in `.opencode/DECISIONS.md` and
`.opencode/CONTEXT-MAP.md`; do not read the whole tree by default.

| Path | Answers | Role |
|------|---------|------|
| [`PRODUCT.md`](PRODUCT.md) | What are we building and why? | Product goals, scope, capabilities, product-level constraints. No detailed implementation decisions. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How is the system structured? | Current architectural truth: layers, data flow, persistence, sync, workers, boundaries, deployment. Does not repeat ADR history. |
| [`decisions/`](decisions/) | Why did we make this decision? | Current ADRs (indexed in `.opencode/DECISIONS.md`). Concise decision records. |
| [`history/`](history/) | What was decided before? | Superseded ADRs / completed change records. **Not** implementation context. |
| [`domain/`](domain/) | What does the system mean? | Entities, terminology, rules, algorithms, invariants, calculations. |
| [`features/`](features/) | What must each feature do? | Goal, scope, requirements, behavior, acceptance criteria, verification, context references. |
| [`research/`](research/) | What evidence informed a decision? | External investigation. Supporting evidence only; opt-in, never default context. |

## Current truth vs history

- Current decisions live in `decisions/` and are indexed by
  `.opencode/DECISIONS.md`.
- Superseded decisions are moved to `history/` and are never treated as
  current.
- `ARCHITECTURE.md` reflects only current decisions. If a document
  contradicts a current decision, that document is stale.
- Historical documents are consulted only to answer "why did we choose
  this?" — never to derive current requirements.

## Conventions

- ADRs: `decisions/ADR-NNN-slug.md`; mark superseded ones for moving to
  `history/` and update `DECISIONS.md`.
- Domain: one file per topic (`domain/<topic>.md`).
- Features: one file per roadmap feature (`features/NNN-slug.md`), each
  with a `## Context` block referencing its required docs.
- Research: one file per question (`research/<topic>.md`) with
  Question/Sources/Findings/Limitations/Recommendation.
