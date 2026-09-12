/**
 * Feature 016 — Dropbox content hash (domain, pure).
 *
 * Implements the published Dropbox algorithm:
 *
 * 1. split the file into 4 MiB blocks (the last may be smaller);
 * 2. SHA-256 each block;
 * 3. concatenate the raw 32-byte digests;
 * 4. SHA-256 the concatenation and hex-encode it.
 *
 * The digest function is injectable so the algorithm can be unit-tested in
 * environments without `crypto.subtle`; production always uses Web Crypto.
 */

/** Dropbox block size: 4 MiB (`4 * 1024 * 1024`). */
export const DROPBOX_BLOCK_SIZE = 4 * 1024 * 1024;

/** Hash one byte range and return its raw digest. */
export type DigestFn = (algorithm: 'SHA-256', data: Uint8Array) => Promise<Uint8Array>;

async function webCryptoDigest(algorithm: 'SHA-256', data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('Web Crypto (crypto.subtle) is not available in this environment.');
  }
  // Copy into an ArrayBuffer-backed view so the argument satisfies `BufferSource`
  // regardless of the caller's backing buffer type (e.g. SharedArrayBuffer).
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await subtle.digest(algorithm, copy);
  return new Uint8Array(digest);
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Compute the Dropbox `content_hash` of `bytes`. Deterministic and pure; the
 * default digest uses Web Crypto.
 */
export async function dropboxContentHash(
  bytes: Uint8Array,
  digest: DigestFn = webCryptoDigest,
): Promise<string> {
  const blockDigests: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += DROPBOX_BLOCK_SIZE) {
    const block = bytes.subarray(offset, Math.min(offset + DROPBOX_BLOCK_SIZE, bytes.byteLength));
    blockDigests.push(await digest('SHA-256', block));
  }
  const concatenated = concatBytes(blockDigests);
  const finalDigest = await digest('SHA-256', concatenated);
  return toHex(finalDigest);
}
