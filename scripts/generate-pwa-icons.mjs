#!/usr/bin/env node
/**
 * Tiny PNG generator for PWA icon placeholders. Outputs a flat
 * solid-color PNG (no compression tricks) at the requested size.
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 * Writes public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, '..', 'public', 'icons');
mkdirSync(ICONS_DIR, { recursive: true });

const BG = [0x1f, 0x6f, 0xeb, 0xff]; // RGBA
const FG = [0xff, 0xff, 0xff, 0xff];

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function generatePng(size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter byte: None
    for (let x = 0; x < size; x += 1) {
      const px = rowStart + 1 + x * 4;
      // Draw a centered rounded square as a placeholder mark.
      const inset = Math.floor(size * 0.18);
      const inX = x >= inset && x < size - inset;
      const inY = y >= inset && y < size - inset;
      const isFg = inX && inY;
      const c = isFg ? FG : BG;
      raw[px] = c[0];
      raw[px + 1] = c[1];
      raw[px + 2] = c[2];
      raw[px + 3] = c[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  for (const variant of [`icon-${size}.png`, `icon-maskable-${size}.png`]) {
    const path = resolve(ICONS_DIR, variant);
    writeFileSync(path, generatePng(size));
    console.log(`wrote ${path}`);
  }
}
