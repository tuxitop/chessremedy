# ADR-010: Charting Library

## Status

Accepted

## Decision

Use Recharts 3.x for the ChessRemedy dashboard.

## Reasons

- Declarative React component model (`<LineChart>`, `<Bar>`,
  `<Tooltip>`) is the most natural fit for a React SPA. Developers
  write JSX, not configuration objects.
- All V1 chart types are first-class components: line, bar,
  pie/donut, area, radar/spider.
- `<ReferenceLine>`, `<ReferenceArea>`, and `<Brush>` provide
  annotation and time-series zoom without plugins.
- `<ResponsiveContainer>` handles responsive resizing out of the box
  via ResizeObserver.
- Touch events handled natively since v0.20.0.
- ARIA attributes, keyboard navigation, and recent accessibilityLayer
  additions show commitment to accessibility.
- TypeScript-first with built-in types.
- MIT license.
- ESM output with `sideEffects: false` for Vite tree-shaking.
- Active maintenance: 27.5k GitHub stars, regular releases.

## Consequences

- Bundle contribution is approximately 147.5 kB gzipped. This is
  larger than Chart.js (69.4 kB) but smaller than ECharts (371 kB)
  and is acceptable for a dashboard SPA.
- Dark/light themes are implemented via style props on components.
  The formal theming system arriving in v3.11.0 can be adopted later.
- If V2 needs advanced charts (heatmaps, gauges), ECharts can be
  added as a secondary library without replacing Recharts.

## Non-V1 deferrals

- Nivo (D3 + React) was not evaluated in depth. Revisit if Recharts
  theming proves insufficient.
- Formal Recharts theming (v3.11.0-canary) is experimental; implement
  dark/light manually for V1.

## Source

`specs/research/charting-library.md`
