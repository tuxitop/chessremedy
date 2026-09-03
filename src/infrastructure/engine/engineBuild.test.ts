import { describe, expect, it } from 'vitest';
import {
  engineBuildToken,
  engineMetadataFor,
  findEngineBuild,
  workerScriptUrl,
  type EngineAssets,
} from './engineBuild';

const ASSETS: EngineAssets = {
  engineName: 'stockfish',
  engineRelease: '18',
  npmVersion: '18.0.8',
  builds: [
    { id: 'lite-single', js: 'stockfish-18-lite-single.js', wasm: 'stockfish-18-lite-single.wasm' },
    { id: 'lite', js: 'stockfish-18-lite.js', wasm: 'stockfish-18-lite.wasm' },
  ],
};

describe('engineBuild', () => {
  it('derives the engine build token from the release', () => {
    expect(engineBuildToken('18', 'lite-single')).toBe('stockfish-18-lite-single');
    expect(engineBuildToken('18', 'lite')).toBe('stockfish-18-lite');
  });

  it('resolves shipped builds by id', () => {
    expect(findEngineBuild(ASSETS, 'lite-single').wasm).toBe('stockfish-18-lite-single.wasm');
    expect(() => findEngineBuild(ASSETS, 'full' as never)).toThrow(/not shipped/);
  });

  it('constructs the worker script URL under a base path', () => {
    expect(workerScriptUrl(ASSETS, 'lite-single', '/')).toBe(
      '/stockfish/stockfish-18-lite-single.js',
    );
    expect(workerScriptUrl(ASSETS, 'lite', '/base/')).toBe('/base/stockfish/stockfish-18-lite.js');
  });

  it('composes domain EngineMetadata with the profile token', () => {
    expect(engineMetadataFor(ASSETS, 'lite-single', 'normal')).toEqual({
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
      profile: 'normal',
    });
  });
});
