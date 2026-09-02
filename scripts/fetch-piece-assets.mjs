#!/usr/bin/env node
/**
 * Fetch piece-set SVG assets from Lichess's CDN into `public/vendor/pieces/`.
 *
 * Lichess serves piece art under
 *   https://lichess1.org/assets/piece/<set>/<color><role>.svg
 * where `<color>` is `w` or `b` (lowercase) and `<role>` is one of
 *   P (pawn), N (knight), B (bishop), R (rook), Q (queen), K (king)
 * (uppercase). So the white king is `wK.svg`, the black queen is
 * `bQ.svg`, etc.
 *
 * `<set>` is one of {cburnett, merida, alpha, chess7, spatial}.
 *
 * All five sets are GPL-3.0-or-later (matching ChessRemedy's license,
 * see ADR-027). The CSS files in `src/components/chessboard/styles/`
 * reference them via relative URLs.
 *
 * Run automatically via the `postinstall` npm script. Idempotent:
 * files already present and non-empty are left untouched.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const SETS = ['cburnett', 'merida', 'alpha', 'chess7', 'spatial'];
const ROLE_CODES = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
const COLORS = ['w', 'b'];
const CDN_BASE = 'https://lichess1.org/assets/piece';

let fetched = 0;
let skipped = 0;
let failed = 0;

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'ChessRemedy/0.1 (build-time asset fetch)' },
      });
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
  }
  throw lastError ?? new Error('fetch failed');
}

for (const set of SETS) {
  for (const [roleName, roleCode] of Object.entries(ROLE_CODES)) {
    for (const color of COLORS) {
      // Internal filename uses the long role name (debuggable); the
      // CDN URL uses the short uppercase role code.
      const internalName = `${roleName}-${color}.svg`;
      const cdnName = `${color}${roleCode}.svg`;
      const dest = join(root, 'public/vendor/pieces', set, internalName);
      const url = `${CDN_BASE}/${set}/${cdnName}`;
      await mkdir(dirname(dest), { recursive: true });

      let needWrite = true;
      try {
        const existing = await stat(dest);
        if (existing.size > 0) {
          needWrite = false;
        }
      } catch {
        /* no existing file */
      }

      if (!needWrite) {
        skipped += 1;
        continue;
      }

      try {
        const response = await fetchWithRetry(url);
        const body = await response.text();
        if (!body.includes('<svg')) {
          console.warn(
            `[fetch-piece-assets] ${set}/${internalName}: response does not look like SVG`,
          );
          failed += 1;
          continue;
        }
        await writeFile(dest, body, 'utf8');
        fetched += 1;
      } catch (err) {
        console.warn(
          `[fetch-piece-assets] ${set}/${internalName}: ${err instanceof Error ? err.message : String(err)}`,
        );
        failed += 1;
      }
    }
  }
}

console.log(`[fetch-piece-assets] fetched=${fetched} skipped=${skipped} failed=${failed}`);
if (failed > 0) {
  console.warn('[fetch-piece-assets] some assets could not be fetched.');
  process.exit(1);
}
