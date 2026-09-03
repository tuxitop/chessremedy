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
  `<Tooltip>`) fits a React SPA — developers write JSX, not
  configuration objects — and every V1 chart type (line, bar,
  pie/donut, area, radar/spider) is a first-class component.
- `<ResponsiveContainer>` (ResizeObserver) and native touch support
  since v0.20.0 cover responsiveness and mobile; ARIA attributes,
  keyboard navigation, and recent accessibilityLayer additions show
  commitment to accessibility.
- TypeScript-first with built-in types, MIT license, and ESM output
  with `sideEffects: false` for Vite tree-shaking.

Full evaluation: `specs/research/charting-library.md`.

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
