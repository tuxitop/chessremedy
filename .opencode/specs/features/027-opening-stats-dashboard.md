# Feature 027 — Opening Statistics & Dashboard

> **Status: draft (idea-level).** Not approved for implementation. Scope,
> behavior and acceptance criteria are intentionally incomplete and will be
> revised before implementation.

## Goal

Bring opening training into the product's insight surfaces: coverage, gaps,
compliance and review load on the Insights/Dashboard pages.

## Idea

This is an aggregation and presentation feature over data already produced by
Features 024 (review state), 025 (coverage/gaps) and 026 (compliance). It
reuses the existing statistics/dashboard infrastructure (Features 014/015) and
adds opening-scoped panels without introducing a new metric engine.

Candidate panels: coverage %, top gaps, repertoire compliance trend, review
backlog / retention, time spent training openings.

## Scope sketch

### In scope

- Opening panels on the Insights/Dashboard pages (Recharts, ADR-010).
- Aggregations derived from repertoire/training/compliance data.
- Filters (color, repertoire, date range) consistent with existing insights.

### Out of scope

- New charting library or metric definitions.
- Engine-based opening evaluation.
- Social/leaderboard or external reporting.

## Dependencies

- Features 014, 015 — statistics and dashboard infrastructure.
- Features 024, 025, 026 — the data being aggregated.
- ADR-010 — Recharts.

## Open questions

1. Which metrics are first-class vs informational.
2. Where opening panels live (new tab vs additions to existing pages).
3. Aggregation cost and whether summaries are cached/derived.
4. How much of Feature 014's aggregation/versioning applies unchanged.

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/features/014-game-history-statistics.md`
- `.opencode/specs/features/015-dashboard.md`
- `.opencode/specs/features/024-opening-trainer.md`
- `.opencode/specs/features/025-opening-coverage-gaps.md`
- `.opencode/specs/features/026-repertoire-compliance.md`
- `.opencode/specs/decisions/ADR-010-charting-library.md`
