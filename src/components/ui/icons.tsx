import type * as React from 'react';

/**
 * Minimal inline SVG icon set (Feather-style paths, no icon dependency).
 * Icons inherit `currentColor` so they adopt button/foreground colour.
 */

interface IconProps {
  readonly size?: number;
  readonly label?: string;
}

function svgProps(size: number): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  };
}

export function SearchIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function BoltIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

export function TrashIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function RefreshIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function CloseIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function PlayIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

/** The shared 🔬 analysis glyph (top nav + analysis actions). */
export const ANALYSIS_GLYPH = '\u{1F52C}';

/** The game-review glyph (opens the Review surface) — distinct from analysis. */
export const REVIEW_GLYPH = '\u{1F4DD}';

/** The per-game puzzle-list glyph (opens the read-only puzzle view, Feature 011). */
export const PUZZLES_GLYPH = '\u{1F9E9}';
