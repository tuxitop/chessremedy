/**
 * Feature 016 — synchronization domain (barrel).
 *
 * Pure, provider-independent sync core: the envelope vocabulary and format,
 * the leaf-collection registry, the ADR-017 record merge, tombstones, the
 * Dropbox content hash and the synced-settings allowlist. No React, Dexie,
 * Worker, `fetch` or engine import.
 */

export {
  SYNC_PAYLOAD_VERSION,
  type DeviceId,
  type RemoteFileMetadata,
  type SyncAnalysisCollectionsV1,
  type SyncCollectionGroup,
  type SyncCollectionName,
  type SyncEnvelopeCollectionsV1,
  type SyncEnvelopeV1,
  type SyncStatus,
  type SyncTombstone,
  type TombstoneKind,
} from './types';

export {
  SYNC_COLLECTION_BY_NAME,
  SYNC_COLLECTION_NAMES,
  SYNC_COLLECTION_SPECS,
  collectionNamesInGroup,
  type SyncCollectionSpec,
} from './collections';

export {
  ENVELOPE_MIGRATIONS,
  applyEnvelopeMigrations,
  migrateEnvelope,
  parseEnvelope,
  serializeEnvelope,
  validateEnvelope,
  type EnvelopeMigration,
  type EnvelopeMigrationRegistry,
} from './envelope';

export {
  mergeCollection,
  mergeSettings,
  mergeTombstones,
  resolveAgainstTombstone,
  type MergeAccessors,
  type MergeCollectionResult,
  type TombstoneResolution,
} from './merge';

export { makeTombstone, tombstoneId } from './tombstone';

export { normalizeTrainingCycleNumbers } from './cycleNumbers';

export { DROPBOX_BLOCK_SIZE, dropboxContentHash, type DigestFn } from './contentHash';

export {
  SYNCED_SETTINGS_KEYS,
  excludeSyncSecrets,
  isSecretSettingKey,
  selectSyncedSettings,
} from './settings';
