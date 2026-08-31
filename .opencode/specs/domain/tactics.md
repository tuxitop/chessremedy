# Tactical Detection

A tactical opportunity is a position where a forcing continuation produces a
meaningful tactical objective.

V1 tactical objectives are limited to the outcome categories defined in
`specs/PRODUCT.md` §8:

- winning material
- forcing mate
- obtaining a decisive advantage
- neutralizing a tactical threat

Detection occurs in two stages:

1. Candidate generation.
2. Deep verification.

A candidate is not considered a training puzzle until verification succeeds.

## Tactical motifs

Tactical-motif detection and labeling (forks, pins, skewers, discovered
attacks, deflections, zwischenzug, overloaded pieces, defensive tactics,
and similar) is **out of scope for V1**. The `tacticalMotifs` field on
the puzzle model is reserved for future use and must not be populated
or relied upon in V1.

V1 records the tactical objective and the verified solution sequence;
it does not assign a motif label to either.
