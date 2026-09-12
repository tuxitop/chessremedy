/**
 * Feature 016 — gzip helpers (infrastructure).
 *
 * The ADR-016 sync payload is a single gzipped JSON file. V1 uses the
 * browser-native `CompressionStream('gzip')` / `DecompressionStream('gzip')`
 * APIs so no runtime dependency is added. Node's test environment exposes the
 * same globals, but the transforms are injectable so a Node-only test (or a
 * future environment without the streams) can supply its own byte transform.
 *
 * When the stream API is unavailable and no transform is injected, the default
 * transform rejects with an actionable message rather than silently passing the
 * bytes through uncompressed.
 */

/** MIME type the sync file is uploaded with (ADR-016). */
export const GZIP_MIME_TYPE = 'application/gzip';

/** A pure byte-in/byte-out (de)compression step. */
export type ByteTransform = (bytes: Uint8Array) => Promise<Uint8Array>;

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

async function runThroughTransform(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      // Copy into an ArrayBuffer-backed view so the chunk satisfies
      // `BufferSource` regardless of the caller's backing buffer type.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      controller.enqueue(copy);
      controller.close();
    },
  });
  const reader = source.pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value !== undefined) {
      chunks.push(value);
    }
  }
  return concatBytes(chunks);
}

/** Default gzip transform over the browser-native stream API. */
async function gzipWithCompressionStream(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      'CompressionStream is unavailable in this environment; inject a gzip transform.',
    );
  }
  return runThroughTransform(bytes, new CompressionStream('gzip'));
}

/** Default gunzip transform over the browser-native stream API. */
async function gunzipWithDecompressionStream(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'DecompressionStream is unavailable in this environment; inject a gunzip transform.',
    );
  }
  return runThroughTransform(bytes, new DecompressionStream('gzip'));
}

/** Gzip `bytes`, or run an injected transform when one is supplied. */
export async function gzipBytes(
  bytes: Uint8Array,
  transform: ByteTransform = gzipWithCompressionStream,
): Promise<Uint8Array> {
  return transform(bytes);
}

/** Gunzip `bytes`, or run an injected transform when one is supplied. */
export async function gunzipBytes(
  bytes: Uint8Array,
  transform: ByteTransform = gunzipWithDecompressionStream,
): Promise<Uint8Array> {
  return transform(bytes);
}
