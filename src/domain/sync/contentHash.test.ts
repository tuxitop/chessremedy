// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { DROPBOX_BLOCK_SIZE, dropboxContentHash } from './contentHash';

function patternedBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = index % 256;
  }
  return bytes;
}

describe('dropboxContentHash', () => {
  it('hashes an empty file to the published empty-content digest', async () => {
    await expect(dropboxContentHash(new Uint8Array(0))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the sub-block reference vector', async () => {
    const bytes = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
    await expect(dropboxContentHash(bytes)).resolves.toBe(
      '6d37795021e544d82b41850edf7aabab9a0ebe274e54a519840c4666f35b3937',
    );
  });

  it('matches the single-block boundary vectors', async () => {
    await expect(dropboxContentHash(patternedBytes(DROPBOX_BLOCK_SIZE - 1))).resolves.toBe(
      '99784285b9f600a39f815b655325968cd32cc753af9786ed51c2d03e50be07ad',
    );
    await expect(dropboxContentHash(patternedBytes(DROPBOX_BLOCK_SIZE))).resolves.toBe(
      '894bbb52d1212d6bcbe9967f1a2169138c4d4af0c8dfbaeae86cd1d3f0c03faf',
    );
  });

  it('matches the multi-block reference vectors', async () => {
    await expect(dropboxContentHash(patternedBytes(DROPBOX_BLOCK_SIZE + 1))).resolves.toBe(
      '9eb62f609dee341fdcc4521fd6d5a78d9e5c5bb36d844618d9e8d1b32f28ba95',
    );
    await expect(dropboxContentHash(patternedBytes(DROPBOX_BLOCK_SIZE + 12345))).resolves.toBe(
      'ce8c7039810fa058beca769635acead8922bd12d224285647c20284808fe92a0',
    );
  });

  it('uses the injected digest function and concatenates raw block digests', async () => {
    const calls: number[] = [];
    const digest = async (_algorithm: 'SHA-256', data: Uint8Array): Promise<Uint8Array> => {
      calls.push(data.byteLength);
      return new Uint8Array(32);
    };
    const hash = await dropboxContentHash(patternedBytes(DROPBOX_BLOCK_SIZE + 3), digest);
    expect(calls).toEqual([DROPBOX_BLOCK_SIZE, 3, 64]);
    expect(hash).toBe('00'.repeat(32));
  });
});
