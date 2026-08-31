# Feature 015 — Dashboard

## Goal

Show meaningful improvement and weaknesses.

## Requirements

Charts for:

- rating
- accuracy
- blunders
- mistakes
- missed tactics
- game phase
- training progress

Filters:

- platform
- time control
- date range

## Acceptance Criteria

Rapid and Blitz are never silently combined.

Charts expose sample size using the rule in `specs/domain/statistics.md`
(V1 minimum sample size is 5; aggregates below that threshold are
replaced with an "insufficient data" placeholder).

Empty states are handled.
