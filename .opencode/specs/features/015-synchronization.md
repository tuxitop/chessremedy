# Feature 015 — Synchronization

## Goal

Synchronize local ChessRemedy data across devices.

## Requirements

- sync abstraction
- provider interface
- Dropbox provider
- push
- pull
- conflict detection
- offline queue
- sync status
- recovery

## Constraint

The application remains fully usable without synchronization.

## Acceptance Criteria

Two devices can synchronize the same user's data without requiring a
central ChessRemedy backend.
