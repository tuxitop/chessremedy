/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'public/vendor/pieces');
const SETS = ['cburnett', 'merida', 'alpha', 'chess7', 'spatial'];
const ROLES = ['queen', 'rook', 'bishop', 'knight'];

describe('piece-set promotion assets', () => {
  it('ships promotion images (Q/R/B/N white) for all five piece sets', () => {
    for (const set of SETS) {
      for (const role of ROLES) {
        const file = join(ROOT, set, `${role}-w.svg`);
        expect(existsSync(file), `${set}/${role}-w.svg`).toBe(true);
      }
    }
  });
});
