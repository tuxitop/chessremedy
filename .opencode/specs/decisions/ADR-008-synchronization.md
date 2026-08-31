# ADR-008: Synchronization

## Status

Accepted

## Decision

Synchronization is provider-independent.

Dropbox is the first planned provider.

## Architecture

Local database
→ Sync engine
→ Sync provider

## Reason

The core product must remain local-first and must not depend on Dropbox.

Other providers may be added later without changing domain logic.
