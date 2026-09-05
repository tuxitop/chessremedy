export { applyV1Schema } from './v1';
export { applyV2Schema } from './v2';
export { applyV3Schema } from './v3';
export { applyV4Schema } from './v4';
export { applyV5Schema } from './v5';
export { applyV6Schema } from './v6';
export { applyV7Schema } from './v7';

import type Dexie from 'dexie';

/**
 * Future schemas (`v2`, `v3`, …) are added here and applied in
 * `database.ts` in order. Each entry is a function that calls
 * `db.version(N).stores({...}).upgrade(...)` on the shared instance.
 */
export type SchemaApplier = (db: Dexie) => void;
