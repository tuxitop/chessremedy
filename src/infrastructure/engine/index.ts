/**
 * Engine infrastructure barrel (Feature 005).
 */

export { AnalysisJobHandle, EngineServiceImpl, createEngineService } from './engineService';
export type { EngineServiceOptions, JobOptions } from './engineService';
export {
  SessionAnalysisCache,
  analysisCacheKey,
  canonicalFen,
  createCachedEngineService,
} from './cache';
export type { EngineAnalysisCache } from './cache';
export { createStockfishWorkerTransport } from './workerTransport';
export type { StockfishWorkerTransportOptions } from './workerTransport';
export { createBrowserEngineService } from './browser';
export {
  ENGINE_NAME,
  EngineAssetsError,
  engineBuildToken,
  engineMetadataFor,
  fetchEngineAssets,
  findEngineBuild,
  workerScriptUrl,
} from './engineBuild';
export type { EngineAssetBuild, EngineAssets } from './engineBuild';
export {
  readBrowserCapabilities,
  resolveEngineCapabilities,
  isMobileEnvironment,
} from './capabilities';
export type { CapabilityEnvironment, EngineCapabilities } from './capabilities';
export {
  ANALYSIS_PROFILE_ORDER,
  PROFILE_CONFIGS,
  profileConfig,
  resolveProfileConfig,
} from './engineProfiles';
export type { ProfileConfig, ResolvedProfileConfig, UciOptionSetting } from './engineProfiles';
export { ENGINE_POSITIONS, findEnginePosition } from './fixtures/enginePositions';
export type { EnginePositionFixture, EnginePositionId } from './fixtures/enginePositions';
export * from './types';
