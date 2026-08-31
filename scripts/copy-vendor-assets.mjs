#!/usr/bin/env node
/**
 * Copy vendor CSS assets from `node_modules` to `public/vendor/`.
 *
 * Some npm packages ship CSS at paths that the package's `exports`
 * map blocks (Vite/Rolldown refuse subpath CSS imports that aren't
 * declared). Copying the file into `public/` and referencing it by
 * URL sidesteps the gate.
 *
 * Run automatically via the `postinstall` npm script. Idempotent.
 */
import { mkdir, copyFile, access as accessFs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const targets = [
  {
    from: join(root, 'node_modules/@lichess-org/pgn-viewer/dist/lichess-pgn-viewer.css'),
    to: join(root, 'public/vendor/pgn-viewer/lichess-pgn-viewer.css'),
  },
];

let copied = 0;
for (const { from, to } of targets) {
  await mkdir(dirname(to), { recursive: true });
  try {
    await accessFs(from);
  } catch {
    console.warn(`[copy-vendor-assets] source not found: ${from}`);
    continue;
  }
  await copyFile(from, to);
  copied += 1;
}

if (copied > 0) {
  console.log(`[copy-vendor-assets] copied ${copied} asset(s).`);
}
