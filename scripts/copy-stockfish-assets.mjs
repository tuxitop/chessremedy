#!/usr/bin/env node
/**
 * Copy Stockfish WASM engine assets into `public/stockfish/` at install time.
 *
 * ADR-012 selects the `stockfish` npm package (nmrugg/stockfish.js). The
 * published package ships the compiled engine files under
 * `node_modules/stockfish/bin/` with names derived from the package's
 * `buildVersion` field (the Stockfish engine release, e.g. `18`), so the
 * exact file names are resolved here rather than hard-coded.
 *
 * We ship two lite builds (ADR-012 consequence):
 *   - `stockfish-{release}-lite-single.{js,wasm}` (~7 MB, single-threaded,
 *     no SharedArrayBuffer) — the default, used everywhere.
 *   - `stockfish-{release}-lite.{js,wasm}` (~7 MB, multi-threaded) — used at
 *     runtime only when cross-origin isolation is available.
 * The full-strength ~100 MB build is intentionally not shipped.
 *
 * A `meta.json` manifest is written next to the assets so the engine service
 * can construct worker URLs and engine identity from the installed package
 * (ARCHITECTURE.md §9, ADR-018/020). `public/stockfish/` is generated and
 * git-ignored (like the fetched piece assets); `npm install` regenerates it.
 *
 * Idempotent: existing files are overwritten only when the source differs.
 */
import { mkdir, readFile, stat, copyFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const PKG_ROOT = join(root, 'node_modules', 'stockfish');
const DEST_DIR = join(root, 'public', 'stockfish');

const BUILDS = [{ id: 'lite-single' }, { id: 'lite' }];

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sameFile(a, b) {
  try {
    const [x, y] = await Promise.all([readFile(a), readFile(b)]);
    return x.equals(y);
  } catch {
    return false;
  }
}

async function main() {
  const pkg = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf8'));
  const release = pkg.buildVersion;
  const npmVersion = pkg.version;

  await mkdir(DEST_DIR, { recursive: true });

  const builds = [];
  let copied = 0;
  let skipped = 0;

  for (const { id } of BUILDS) {
    const base = `stockfish-${release}-${id}`;
    const entry = { id, js: `${base}.js`, wasm: `${base}.wasm` };
    builds.push(entry);
    for (const file of [entry.js, entry.wasm]) {
      const src = join(PKG_ROOT, 'bin', file);
      const dest = join(DEST_DIR, file);
      if (!(await fileExists(src))) {
        throw new Error(`Missing stockfish asset in package: ${src}`);
      }
      if ((await fileExists(dest)) && (await sameFile(src, dest))) {
        skipped += 1;
        continue;
      }
      await copyFile(src, dest);
      copied += 1;
    }
  }

  const meta = {
    engineName: 'stockfish',
    engineRelease: release,
    npmVersion,
    builds,
  };
  await writeFile(join(DEST_DIR, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  console.log(
    `stockfish ${npmVersion} (engine ${release}): ${copied} copied, ${skipped} unchanged -> public/stockfish/`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
