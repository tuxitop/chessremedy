# ADR-007: Spaced Repetition

## Status

Superseded by ADR-031.

## Decision

~~Use FSRS for puzzle scheduling.~~

V1 does not use an individual spaced-repetition scheduler. Puzzles are
trained in fixed sets over repeated training cycles (ADR-031).

## Reason

~~Use an established spaced-repetition algorithm rather than creating an
ad-hoc scheduling system.~~

An individual scheduler is deferred; fixed-set cycle training fits V1's
mistake-derived puzzle sets and improvement measurement better at this
stage.

## Supersession note

ADR-031 replaces this decision with cycle-based tactical training.
Review history remains separate from current scheduling state; the
attempt/cycle history that replaces it is also stored independently of
any future scheduler. FSRS remains a possible future scheduling
strategy (ADR-031, Alternatives considered).
