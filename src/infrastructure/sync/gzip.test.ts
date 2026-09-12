// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { gzipBytes, gunzipBytes, type ByteTransform } from './gzip';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

describe('gzipBytes / gunzipBytes', () => {
  it('round-trips arbitrary bytes through the default gzip transforms', async () => {
    const input = textEncoder.encode('ChessRemedy sync payload '.repeat(200));
    const compressed = await gzipBytes(input);
    expect(compressed.byteLength).toBeGreaterThan(0);
    expect(compressed.byteLength).toBeLessThan(input.byteLength);
    const restored = await gunzipBytes(compressed);
    expect([...restored]).toEqual([...input]);
    expect(textDecoder.decode(restored)).toBe(textDecoder.decode(input));
  });

  it('produces deterministic bytes for the same input', async () => {
    const input = textEncoder.encode(JSON.stringify({ b: 'x', a: [1, 2, 3] }));
    const first = await gzipBytes(input);
    const second = await gzipBytes(input);
    expect([...first]).toEqual([...second]);
  });

  it('accepts injected transforms so a Node-only fallback can be supplied', async () => {
    const input = new Uint8Array([1, 2, 3]);
    const identity: ByteTransform = async (bytes) => bytes;
    expect(await gzipBytes(input, identity)).toBe(input);
    expect(await gunzipBytes(input, identity)).toBe(input);
  });

  it('rejects with an actionable message when the stream API is unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    try {
      await expect(gzipBytes(new Uint8Array([1]))).rejects.toThrow(/CompressionStream/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
