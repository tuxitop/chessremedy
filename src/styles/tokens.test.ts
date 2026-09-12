/**
 * Feature 017 (W1) — theme token regression guard.
 *
 * The light theme must render an off-white page (`--color-bg`) with white
 * cards/surfaces (`--color-surface`), while the dark block stays untouched.
 * Token values live in CSS, so this guard parses `tokens.css` directly.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOKENS_CSS = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Extract the declarations of the first block whose selector contains `selector`. */
function block(selector: string): Record<string, string> {
  const selectorIndex = TOKENS_CSS.indexOf(selector);
  if (selectorIndex === -1) {
    throw new Error(`missing token block for selector ${selector}`);
  }
  const open = TOKENS_CSS.indexOf('{', selectorIndex);
  const close = TOKENS_CSS.indexOf('}', open);
  const declarations: Record<string, string> = {};
  for (const line of TOKENS_CSS.slice(open + 1, close).split(';')) {
    const [name, value] = line.split(':');
    if (name && value) {
      declarations[name.trim()] = value.trim();
    }
  }
  return declarations;
}

const light = block("[data-theme='light']");
const dark = block("[data-theme='dark']");

describe('theme tokens (Feature 017 light theme)', () => {
  it('uses an off-white page canvas with white surfaces in the light theme', () => {
    expect(light['--color-bg']).toBe('#f6f8fa');
    expect(light['--color-surface']).toBe('#ffffff');
    // The page and elevated fills may share the off-white value; surfaces stay white.
    expect(light['--color-bg-elevated']).toBe('#f6f8fa');
    expect(light['--color-bg-sunken']).toBe('#eaeef2');
  });

  it('leaves the dark theme token block unchanged', () => {
    expect(dark['--color-bg']).toBe('#0d1117');
    expect(dark['--color-bg-elevated']).toBe('#161b22');
    expect(dark['--color-bg-sunken']).toBe('#010409');
    expect(dark['--color-surface']).toBe('#161b22');
    expect(dark['--color-fg']).toBe('#e6edf3');
  });
});
