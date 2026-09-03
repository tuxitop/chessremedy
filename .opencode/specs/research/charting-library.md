# Charting Library Research

## Question

Which charting library is best suited for ChessRemedy's React SPA dashboard (feature 012), considering requirements for responsive charts across desktop/tablet/mobile, dark/light theme support, TypeScript-first development, small-to-medium dataset performance, Vite compatibility, and long-term maintenance stability?

## Sources

- npm registry API: `recharts`, `echarts`, `echarts-for-react`, `chart.js`, `react-chartjs-2`, `@visx/shape`, `@visx/visx`
- GitHub repositories: `recharts/recharts`, `apache/echarts`, `airbnb/visx`, `chartjs/Chart.js`, `reactchartjs/react-chartjs-2`
- GitHub Releases pages for all five projects
- Bundlephobia API for bundle size measurements
- Official documentation sites (recharts.org, echarts.apache.org, visx.airbnb.tech, chartjs.org)

## Findings

### 1. Recharts

| Attribute | Detail |
|---|---|
| **Latest stable version** | 3.10.1 (released 25 Jul 2025); canary 3.11.0 in progress |
| **License** | MIT |
| **GitHub stars** | 27.5k |
| **Open issues** | 392 |
| **Open PRs** | 44 |
| **Last release** | 25 Jul 2025 |
| **Render engine** | SVG (via D3 for calculations) |
| **React peer deps** | ^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0 |
| **Bundle size (gzipped)** | 147.5 kB |
| **Bundle size (unminified)** | 561.7 kB |
| **Dependency count** | 11 (includes redux, immer, reselect, d3-*, victory-vendor) |
| **TypeScript** | Built-in (types shipped with package) |
| **ESM support** | Yes (`es6/index.js`); `hasJSModule` and `hasJSNext` both true |
| **Tree-shaking** | `sideEffects: false` declared |
| **Component model** | Declarative React components wrapping SVG. `<LineChart>`, `<BarChart>`, `<PieChart>`, `<AreaChart>`, `<RadarChart>`, `<ComposedChart>` with child components `<Line>`, `<Bar>`, `<Area>`, `<XAxis>`, `<YAxis>`, `<Tooltip>`, `<Legend>`, `<CartesianGrid>`, `<ReferenceLine>`, `<ReferenceArea>`, `<Brush>`, `<ResponsiveContainer>` |
| **Responsiveness** | Built-in via `<ResponsiveContainer>` component that uses a ResizeObserver-based hook (`useElementOffset`). Wraps any chart to make it fill its parent container. |
| **Mobile/touch** | Touch event handling supported since v0.20.0. `onTouchStart`, `onTouchMove`, `onTouchEnd` on line, area, bar, scatter charts. |
| **Accessibility** | ARIA attributes support since v1.5.0 (aria-*, role, focusable, tabIndex). Recent canary adds `accessibilityLayer`, `title`, and `desc` props on Sankey. Keyboard navigation in Pie chart added in v2.2.0. |
| **Tooltips** | `<Tooltip>` component with customizable `content`, `contentStyle`, `formatter`, `labelFormatter`, `itemSorter`. Rich payload data. Smart positioning with direction reversal. |
| **Annotations** | `<ReferenceLine>`, `<ReferenceArea>`, `<ReferenceDot>` for target lines, reference areas, and custom marks. `<Label>` and `<LabelList>` for data labels. |
| **Time-series** | D3 time scales under the hood. `<Brush>` for zoom/pan. No built-in time axis type but XAxis with dataKey on Date objects works. |
| **Theme support** | Custom themes via `style` props on individual components. No built-in dark/light toggle but v3.11.0-canary introduces a formal theming system (experimental). Custom palettes via `colors` arrays. |
| **Chart types** | Line, Bar, Area, Pie, Donut (Pie with innerRadius), Radar/Spider, Scatter, Composed (mixed), RadialBar, Treemap, Funnel, Sankey, Sunburst. All ChessRemedy V1 requirements covered. |
| **Animation** | Built-in animation via `react-smooth`. Configurable `isAnimationActive`, `animationDuration`, `animationEasing`, `animationBegin`. Smooth transitions on data updates. |
| **Small dataset perf** | SVG rendering is fine for 100-10k points. For 10k+ points, SVG DOM nodes become a bottleneck (each point is a DOM element). Recharts uses `react-redux` and `reselect` for memoized state, which helps. |
| **React 19** | Supported via peer dependency range. |

**Key strength**: Declarative, composable React components that feel native to JSX. Minimal learning curve for React developers.

**Key weakness**: Bundle size (147.5 kB gzipped) is the largest among the SVG-based options due to Redux/immer/reselect dependency tree.

---

### 2. Apache ECharts (via echarts-for-react)

| Attribute | Detail |
|---|---|
| **Latest stable version (echarts)** | 6.1.0 (released 19 May 2025) |
| **Latest stable version (echarts-for-react)** | 3.0.6 (released Jun 2025) |
| **License** | Apache-2.0 (echarts); MIT (echarts-for-react) |
| **GitHub stars** | 67.2k (echarts) |
| **Open issues** | 1,300+ (echarts); 60+ (echarts-for-react) |
| **Last release** | 19 May 2025 (echarts 6.1.0) |
| **Render engine** | Canvas (via zrender); WebGL available via ECharts GL extension |
| **React peer deps** | react ^15.0.0 \|\| >=16.0.0 (echarts-for-react); echarts ^3-6 |
| **Bundle size (gzipped)** | 368 kB (echarts) + 3.6 kB (echarts-for-react) = ~371 kB total |
| **Bundle size (unminified)** | 1.1 MB (echarts) |
| **Dependency count** | 2 (echarts: tslib, zrender); echarts-for-react: 2 (size-sensor, fast-deep-equal) |
| **TypeScript** | Built-in (types shipped in `types/` directory with both .d.ts and .d.cts) |
| **ESM support** | Yes (`type: "module"` in package.json; extensive `exports` map) |
| **Tree-shaking** | Partial. echarts has `sideEffects` declarations for many files. Can import chart types individually: `import { LineChart } from 'echarts/charts'`. But the `index.js` entry includes everything. |
| **Component model** | echarts-for-react wraps echarts in a `<ReactECharts>` component that accepts an `option` prop (echarts configuration object). The configuration is a single large JSON object, not composable React components. |
| **Responsiveness** | Built-in via `autoResize` prop in echarts-for-react (uses `size-sensor`). ECharts itself has responsive behaviors for grid margins and legend positioning. |
| **Mobile/touch** | Excellent. Built-in touch gesture support for dataZoom, tooltip interaction, and chart panning. Canvas rendering handles touch natively. |
| **Accessibility** | ECharts 5+ includes `aria` component with `decal` patterns for colorblind accessibility. Screen reader support via `aria` option. ECharts 6 continues this. |
| **Tooltips** | Highly customizable tooltip with `formatter` function (string or callback), `position`, `backgroundColor`, `borderColor`, `extraCssText`. Can render HTML/React in tooltip via custom `formatter`. |
| **Annotations** | `markLine`, `markPoint`, `markArea` on any series. `visualMap` component for conditional coloring. `graphic` component for arbitrary shapes/text. |
| **Time-series** | First-class `axis.type: 'time'` with `dataZoom` (slider and inside), `brush` component for range selection. Best-in-class time-series support. |
| **Theme support** | Built-in dark theme (`theme: 'dark'`). Custom themes via `echarts.registerTheme()`. Theme builder tool on echarts.apache.org. Dark/light switching is straightforward. |
| **Chart types** | Line, Bar, Pie, Radar, Scatter, Area (via line with `areaStyle`), plus: Gauge, Funnel, Treemap, Sunburst, Sankey, Boxplot, Candlestick, Heatmap, Graph, Parallel, Calendar, Custom. Vastly exceeds V1 requirements. |
| **Animation** | Excellent. Built-in animation system with `animationDuration`, `animationEasing`, `animationDelay`. Canvas rendering provides smooth 60fps animations. |
| **Small dataset perf** | Canvas rendering is highly performant for large datasets (10k+ points). For small datasets (100-1k), the overhead is negligible. Canvas outperforms SVG at scale. |
| **React 19** | echarts-for-react peer dep is `>=16.0.0`, which includes 19. |

**Key strength**: Most powerful charting library available. Excellent performance, rich feature set, built-in dark theme, first-class time-series support.

**Key weakness**: Largest bundle size (371 kB gzipped). Configuration-as-JSON-object is less idiomatic in React than declarative components. `echarts-for-react` is a thin wrapper maintained by a single developer, not by Apache.

---

### 3. visx (Airbnb)

| Attribute | Detail |
|---|---|
| **Latest stable version** | 4.0.0 (released 11 Jun 2025) |
| **License** | MIT |
| **GitHub stars** | 21k |
| **Open issues** | 115 |
| **Open PRs** | 33 |
| **Last release** | 11 Jun 2025 |
| **Render engine** | SVG (D3 for calculations, React for DOM) |
| **React peer deps** | ^18.0.0 \|\| ^19.0.0 |
| **Bundle size (gzipped)** | ~10.7 kB per package (e.g., `@visx/shape`); total depends on packages used |
| **Bundle size (unminified)** | ~35.6 kB per package |
| **Dependency count** | Varies by package (5 for `@visx/shape`: d3-shape, d3-path, classnames, @visx/group, @visx/vendor) |
| **TypeScript** | Built-in (types shipped; `@types/react` is optional peer dep) |
| **ESM support** | Yes (exports map with `import` and `require`) |
| **Tree-shaking** | Excellent. `sideEffects: false`. Pick only the packages you need: `@visx/shape`, `@visx/scale`, `@visx/group`, `@visx/axis`, `@visx/tooltip`, `@visx/responsive`, etc. |
| **Component model** | Low-level primitives: `<LinePath>`, `<Bar>`, `<AreaClosed>`, `<Pie>`, `<Line>`, `<ScaleX>`, `<ScaleY>`, `<AxisBottom>`, `<AxisLeft>`, `<Tooltip>`, `<ParentSize>`. You compose these into charts yourself. |
| **Responsiveness** | `@visx/responsive` provides `<ParentSize>` and `<ResponsiveSVG>` components using ResizeObserver. |
| **Mobile/touch** | Manual. You get SVG elements and must wire up touch events yourself. No built-in tooltip positioning for touch. |
| **Accessibility** | Minimal built-in. You must add ARIA attributes yourself. No built-in keyboard navigation or screen reader support. |
| **Tooltips** | `@visx/tooltip` provides `<Tooltip>`, `<TooltipWithBounds>`, `<Portal>` with positioning utilities. Customizable but requires manual wiring. |
| **Annotations** | No built-in annotation components. You render SVG elements directly. |
| **Time-series** | D3 scales (`@visx/scale` includes `scaleTime`, `scaleUtc`). You build axes and zoom yourself. |
| **Theme support** | No built-in theming. You control all colors via props. Custom palettes are trivial since you control rendering. |
| **Chart types** | Not a charting library. It's a set of visualization primitives. You build line, bar, pie, area, radar charts from scratch using the primitives. |
| **Animation** | No built-in animation (by design). You integrate with `framer-motion`, `react-spring`, or other animation libraries. |
| **Small dataset perf** | SVG. Fine for small datasets. Performance depends on your implementation. |
| **React 19** | Supported in v4.0.0 (requires React 18 or 19). |

**Key strength**: Maximum flexibility and control. Smallest possible bundle since you only import what you need. Ideal for building a custom charting system.

**Key weakness**: Requires significant implementation effort. No built-in chart components, annotations, accessibility, or animation. ChessRemedy would need to build its own chart components on top of visx primitives.

---

### 4. Chart.js (via react-chartjs-2)

| Attribute | Detail |
|---|---|
| **Latest stable version (chart.js)** | 4.5.1 (released 13 Oct 2025) |
| **Latest stable version (react-chartjs-2)** | 5.3.1 (released Oct 2025) |
| **License** | MIT |
| **GitHub stars** | 67.7k (Chart.js) |
| **Open issues** | 499 (Chart.js) |
| **Open PRs** | 85 (Chart.js) |
| **Last release** | 13 Oct 2025 (Chart.js 4.5.1) |
| **Render engine** | Canvas |
| **React peer deps** | ^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0 (react-chartjs-2); chart.js ^4.1.1 |
| **Bundle size (gzipped)** | 68.4 kB (chart.js) + 1.0 kB (react-chartjs-2) = ~69.4 kB total |
| **Bundle size (unminified)** | 200.8 kB (chart.js) |
| **Dependency count** | 1 (chart.js: @kurkle/color); react-chartjs-2: 0 |
| **TypeScript** | Built-in (types shipped: `types/dist/types.d.ts` for chart.js; `dist/index.d.ts` for react-chartjs-2) |
| **ESM support** | Yes (`type: "module"` in both packages; exports map) |
| **Tree-shaking** | Partial. chart.js has `sideEffects` for auto-registration files. Tree-shaking works when importing individual components: `import { LineController } from 'chart.js'`. react-chartjs-2 has `sideEffects: false`. |
| **Component model** | react-chartjs-2 provides React wrapper components: `<Line>`, `<Bar>`, `<Pie>`, `<Doughnut>`, `<Radar>`, `<PolarArea>`, `<Scatter>`, `<Bubble>`. Each accepts `data` and `options` props as plain objects. |
| **Responsiveness** | Built-in. Chart.js `responsive: true` (default) uses ResizeObserver. `maintainAspectRatio` option. `react-chartjs-2` passes this through. |
| **Mobile/touch** | Good. Chart.js handles touch events natively for tooltips and hover. |
| **Accessibility** | Limited. Chart.js has some ARIA support but not comprehensive. No built-in screen reader descriptions. |
| **Tooltips** | Built-in tooltip system with callbacks (`title`, `label`, `footer`). Customizable via `plugins.tooltip` options. Rich content via `external` callback. |
| **Annotations** | Via `chartjs-plugin-annotation` (community plugin): reference lines, boxes, labels, ellipses. Not built-in. |
| **Time-series** | Requires adapter: `chartjs-adapter-luxon` or `chartjs-adapter-date-fns`. Not built-in. |
| **Theme support** | Custom defaults via `Chart.defaults`. No built-in dark/light toggle. Manual color management. |
| **Chart types** | Line, Bar, Pie, Doughnut, Radar, PolarArea, Scatter, Bubble. Covers ChessRemedy V1 requirements. |
| **Animation** | Built-in animation system with `animation`, `animations` options. Configurable duration, easing, delay. |
| **Small dataset perf** | Canvas rendering. Good performance for small-to-medium datasets. Canvas outperforms SVG at scale. |
| **React 19** | Supported via peer dependency range. |

**Key strength**: Smallest combined bundle (69.4 kB gzipped) with good chart coverage. Simple API. Most popular charting library by npm downloads (12.8M/week for chart.js). Mature and stable.

**Key weakness**: Configuration-as-objects (not composable React components). Time-series requires adapter plugin. Annotations require community plugin. Accessibility is limited.

---

### Comparison Table

| Criterion | Recharts | ECharts + echarts-for-react | visx | Chart.js + react-chartjs-2 |
|---|---|---|---|---|
| **Bundle size (gzip)** | 147.5 kB | ~371 kB | ~10-30 kB (per package) | ~69.4 kB |
| **Render engine** | SVG | Canvas (WebGL ext.) | SVG | Canvas |
| **React component model** | Declarative, composable | JSON config object | Low-level primitives | Wrapper components |
| **TypeScript** | Built-in | Built-in | Built-in | Built-in |
| **ESM / tree-shaking** | Yes / `sideEffects: false` | Partial / individual imports | Yes / excellent | Yes / partial |
| **Responsiveness** | `<ResponsiveContainer>` | `autoResize` prop | `@visx/ParentSize` | Built-in `responsive` |
| **Mobile/touch** | Good | Excellent | Manual | Good |
| **Accessibility** | ARIA + keyboard (partial) | ARIA + decal patterns | Manual | Limited |
| **Dark/light theme** | Style props (theming in canary) | Built-in dark theme | Manual (full control) | Manual defaults |
| **Tooltips** | `<Tooltip>` component | Highly customizable | `@visx/tooltip` | Built-in callbacks |
| **Annotations** | `<ReferenceLine/Area/Dot>` | `markLine/Point/Area` | Manual SVG | `chartjs-plugin-annotation` |
| **Time-series** | D3 time scales | First-class `axis.type: 'time'` | D3 scales (manual) | Adapter plugin needed |
| **Chart types** | Line, Bar, Pie, Radar, Area, + more | All + Gauge, Heatmap, etc. | Primitives only | Line, Bar, Pie, Radar, + more |
| **Animation** | Built-in (react-smooth) | Excellent (built-in) | Manual (framer-motion etc.) | Built-in |
| **React 19** | Yes | Yes (via peer dep range) | Yes (v4.0.0) | Yes |
| **Vite compatible** | Yes | Yes | Yes | Yes |
| **GitHub stars** | 27.5k | 67.2k | 21k | 67.7k |
| **npm weekly downloads** | ~2.5M | ~3.5M (echarts) | ~95k (@visx/visx) | ~4.5M (react-chartjs-2) |
| **Maintenance** | Active (regular releases) | Active (Apache project) | Active (v4 released Jun 2025) | Active (regular releases) |
| **License** | MIT | Apache-2.0 | MIT | MIT |
| **Learning curve** | Low | Medium | High | Low |

---

## Limitations

1. **Bundle size estimates are approximate**. Bundlephobia measures the library in isolation; actual application bundle impact depends on what parts are imported and how Vite's tree-shaking interacts with the library's module structure.

2. **Accessibility data is based on documentation claims, not audit results**. No library was formally audited for WCAG compliance. Real-world accessibility depends on implementation choices.

3. **Performance benchmarks were not conducted**. The dataset size assessments are based on rendering engine characteristics (SVG vs Canvas) rather than measured benchmarks for ChessRemedy's specific data patterns.

4. **Maintenance trajectory is a projection**. Past release frequency does not guarantee future maintenance. ECharts benefits from Apache Foundation governance; Recharts relies on community maintainers; Chart.js has a small dedicated team; visx is backed by Airbnb but has fewer maintainers.

5. **echarts-for-react is a community wrapper**, not an official Apache project. Its maintenance depends on a single developer (`hustcc`). If it becomes unmaintained, ChessRemedy would need to fork or replace it.

6. **visx v4 is recent** (Jun 2025). While it supports React 18/19, it dropped React 15-17 support, which is fine for ChessRemedy but limits ecosystem compatibility.

## Recommendation

### Recommended: **Recharts** (v3.10.1)

**Primary reasons:**

1. **React-native API design**: Recharts' declarative, composable component model (`<LineChart>`, `<Line>`, `<Tooltip>`) is the most natural fit for a React SPA. Developers write JSX, not configuration objects. This reduces cognitive load and makes charts easier to maintain.

2. **Complete chart coverage**: All ChessRemedy V1 chart types (line, bar, pie/donut, area, radar/spider) are first-class components. `<ReferenceLine>`, `<ReferenceArea>`, and `<Brush>` provide annotation and time-series zoom capabilities without plugins.

3. **Built-in responsiveness**: `<ResponsiveContainer>` handles responsive resizing out of the box using ResizeObserver. No additional setup needed.

4. **Good mobile support**: Touch events are handled natively since v0.20.0. The library has been used in production mobile apps for years.

5. **Adequate accessibility**: ARIA attributes, keyboard navigation in Pie charts, and recent `accessibilityLayer` additions show commitment to accessibility. Not perfect, but better than most alternatives.

6. **TypeScript-first**: Built-in types, no DefinitelyTyped needed. Strong type safety for props.

7. **Active maintenance**: Regular releases (v3.10.1 in Jul 2025, canary v3.11.0 in Aug 2025). Active contributor community with 27.5k GitHub stars. The canary release introduces a formal theming system.

8. **MIT license**: Fully compatible with ChessRemedy's GPL-3.0-or-later posture (ADR-027); MIT is on the allowed-dependency list in `AGENTS.md`.

9. **Vite compatibility**: ESM output, `sideEffects: false`, works with Vite's tree-shaking out of the box.

10. **Bundle size trade-off is acceptable**: 147.5 kB gzipped is larger than Chart.js (69.4 kB) but smaller than ECharts (371 kB). For a dashboard-heavy SPA, this is a reasonable cost for the developer experience and feature set.

**Why not the alternatives:**

- **ECharts**: Best raw feature set and performance, but 371 kB bundle is excessive for V1 dashboard charts. The JSON-config API is less idiomatic in React. The `echarts-for-react` wrapper has single-maintainer risk.

- **visx**: Maximum flexibility but requires building every chart from scratch. For ChessRemedy V1, this would add weeks of implementation time for chart components that Recharts provides out of the box.

- **Chart.js**: Strong contender with smaller bundle (69.4 kB), but time-series requires an adapter plugin, annotations require a community plugin, and the configuration-object API is less React-idiomatic than Recharts' component model.

## Impact on ChessRemedy

1. **Feature 015 (Dashboard)**: Recharts provides all required chart types with minimal setup. `<ResponsiveContainer>` ensures desktop/tablet/mobile support. Custom tooltips can show chess-specific data (rating, accuracy percentages, blunder counts).

2. **Theme support**: Dark/light themes can be implemented via Recharts' style props on components. The upcoming theming system in v3.11.0 will provide a more formal approach.

3. **Bundle budget**: 147.5 kB gzipped is within acceptable bounds for a dashboard SPA. If bundle size becomes critical, individual Recharts components can be imported to reduce the footprint (e.g., importing only `LineChart`, `BarChart`, `PieChart` rather than the full library).

4. **Developer experience**: The declarative component model aligns with ChessRemedy's React + TypeScript architecture. Charts are testable, composable, and maintainable.

5. **Future extensibility**: If ChessRemedy needs more advanced charts (heatmaps, gauges) in V2, Recharts supports them. Alternatively, ECharts could be added alongside Recharts for specialized visualizations without replacing it.

## Open Questions

1. **Should we evaluate Recharts' tree-shaking impact more precisely?** Importing only needed chart types (Line, Bar, Pie, Radar, Area) vs the full library could reduce bundle size significantly. This requires a Vite production build test.

2. **Is the upcoming Recharts theming system (v3.11.0) stable enough to adopt?** The canary release notes indicate it's experimental. ChessRemedy may need to implement dark/light theming manually for V1 and migrate to the formal system later.

3. **Does ChessRemedy need ECharts for any advanced visualizations?** If V2 requires heatmaps (e.g., piece activity heatmaps) or gauge charts (e.g., accuracy gauges), ECharts could be added as a secondary library for those specific use cases.

4. **What is the actual touch interaction quality on mobile?** Recharts' touch support should be validated on real mobile devices for tooltip interaction and chart panning behavior.

5. **Should we consider Nivo (built on D3 + React)?** Nivo was not in the original investigation scope but offers a declarative API similar to Recharts with better built-in theming. It may be worth a follow-up evaluation if Recharts' theming proves insufficient.
