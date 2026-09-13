// Rasterizes `public/chess-remedy.svg` into the PWA / iOS install icons.
//
// Uses the already-installed Playwright Chromium (no extra dependency): the SVG
// is drawn onto a canvas in the browser and exported as PNG. Re-run after the
// source SVG changes:  npm run generate-icons
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'public', 'chess-remedy.svg');
const outDir = path.join(root, 'public', 'icons');

// `background: null` keeps transparency ("any" icons). Maskable / iOS icons get
// an opaque full-bleed background and the mark scaled into the safe zone.
const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: 1, background: null },
  { file: 'icon-512.png', size: 512, scale: 1, background: null },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.76, background: '#0d1117' },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.84, background: '#0d1117' },
];

const svg = await readFile(svgPath, 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const target of TARGETS) {
    const png = await page.evaluate(
      async ({ src, size, scale, background }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (background !== null) {
          context.fillStyle = background;
          context.fillRect(0, 0, size, size);
        }
        const drawn = size * scale;
        const offset = (size - drawn) / 2;
        context.drawImage(image, offset, offset, drawn, drawn);
        return canvas.toDataURL('image/png');
      },
      { src: dataUrl, size: target.size, scale: target.scale, background: target.background },
    );
    const base64 = png.slice(png.indexOf(',') + 1);
    await writeFile(path.join(outDir, target.file), Buffer.from(base64, 'base64'));
    console.log(`wrote ${target.file} (${target.size}x${target.size})`);
  }
} finally {
  await browser.close();
}
