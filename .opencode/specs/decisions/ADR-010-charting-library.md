# ADR-010: Charting Library

## Status

Accepted

## Decision

ChessRemedy uses Recharts for the dashboard.

Exact version follows the **Dependency policy in `AGENTS.md`**
(latest stable by default). The `package.json` caret range and the
lockfile are the source of truth.

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

## Consequences

- Bundle contribution is dominated by Recharts' own size and is
  acceptable for a dashboard SPA.
- Dark/light themes are implemented via Recharts' style props on
  components.
- If V2 needs advanced charts (heatmaps, gauges), ECharts can be
  added as a secondary library without replacing Recharts.

## Non-V1 deferrals

- Nivo (D3 + React) was not evaluated in depth. Revisit if Recharts
  theming proves insufficient.

## Source

`specs/research/charting-library.md`
