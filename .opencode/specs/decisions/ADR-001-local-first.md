# ADR-001: Local-First Architecture

## Status

Accepted

## Decision

IndexedDB is the primary persistent store.

The application must be useful without a remote backend.

## Reasons

- static deployment
- offline support
- privacy
- no mandatory infrastructure
- local Stockfish analysis
- low operating cost

## Consequences

Synchronization is optional infrastructure.

The application must provide reliable database migrations and backup/export.
