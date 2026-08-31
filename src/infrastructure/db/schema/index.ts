export { applyV1Schema } from './v1';

import type Dexie from 'dexie';

/**
 * Future schemas (`v2`, `v3`, …) are added here and applied in
 * `database.ts` in order. Each entry is a function that calls
 * `db.version(N).stores({...}).upgrade(...)` on the shared instance.
 */
export type SchemaApplier = (db: Dexie) => void;
