import type * as React from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import { formatEvaluation, formatPv } from './engineFormat';
import { evaluationFromBottom, type PlayerColor } from './evaluation';
import { EngineSettingsPopover } from './EngineSettingsPopover';
import type { AnalysisController } from './useAnalysisController';
import styles from './AnalysisPanel.module.css';

/** Cached (stored-analysis) content shown when the engine is off (Review). */
export interface StoredPanelData {
  /** Identity of the analysis that produced the shown data, e.g. an engine. */
  readonly engineLabel: string | null;
  /** Header evaluation text (bottom-player perspective), or `null`. */
  readonly evalText: string | null;
  /** Search depth of the top stored line, when reported. */
  readonly depth: number | null;
  /** Stored engine lines, ready-to-render. */
  readonly lines: readonly { readonly evalText: string; readonly pvText: string }[];
}

export interface AnalysisPanelProps {
  readonly controller: AnalysisController;
  readonly capabilities: EngineCapabilities;
  /** FEN of the current position (for rendering PVs). */
  readonly fen: string;
  /** Player at the bottom of the board (for eval text perspective). */
  readonly bottomColor: PlayerColor;
  /** Side to move at the current position. */
  readonly sideToMove: PlayerColor;
  /** Optional node rendered after the engine-settings gear (board settings). */
  readonly rightSlot?: React.ReactNode;
  /** When given, the panel renders this cached data while the engine is off
   * (Game Review stored mode) instead of the idle "off" state. */
  readonly stored?: StoredPanelData | null;
}

interface DisplayLine {
  readonly key: string;
  readonly evalText: string;
  readonly pvText: string;
  readonly testId?: string;
}

/**
 * Engine analysis panel: the header (toggle · eval · engine version ·
 * engine-settings · board-settings), the reached-depth row, and the engine
 * lines — used by Live Analysis, the playground and Game Review (stored mode
 * feeds the same panel cached `MoveAnalysis` data while the engine is off, so
 * the two surfaces are identical).
 */
export function AnalysisPanel({
  controller,
  capabilities,
  fen,
  bottomColor,
  sideToMove,
  rightSlot,
  stored = null,
}: AnalysisPanelProps): React.JSX.Element {
  const { enabled, analyzing, lines, error, reachedDepth, engineLabel } = controller;
  // Stored content counts only while it actually fills the lines area: the
  // engine-lines region must never render an *empty* area when the engine is
  // off. A stored panel with no lines behaves like the plain "off" state.
  const storedActive = stored !== null && !enabled && stored.lines.length > 0;

  const liveBestEval: EngineEvaluation | null =
    enabled && lines.length > 0 ? (lines[0]!.evaluation ?? null) : null;
  const liveEvalText =
    liveBestEval === null
      ? null
      : formatEvaluation(evaluationFromBottom(liveBestEval, bottomColor, sideToMove));

  const evalText = enabled ? liveEvalText : storedActive ? stored!.evalText : null;
  const statusText = !enabled
    ? storedActive
      ? 'Off'
      : 'Off'
    : analyzing
      ? 'Analyzing…'
      : engineLabel
        ? 'Ready'
        : 'Starting…';

  const displayLines: DisplayLine[] = enabled
    ? lines.map((line) => ({
        key: `${fen}|${line.multipv}`,
        evalText: formatEvaluation(line.evaluation),
        pvText: formatPv(fen, line.principalVariation),
      }))
    : storedActive
      ? stored!.lines.map((line, index) => ({
          key: `stored|${index}`,
          evalText: line.evalText,
          pvText: line.pvText,
          testId: 'stored-line',
        }))
      : [];

  // The lines region is reserved whenever the engine is on (even before the
  // first line arrives, so the panel never collapses while thinking) or when
  // stored lines actually exist to fill it. It is never an empty placeholder
  // area when the engine is off.
  const showRegion = enabled || storedActive;
  const showIdle = !enabled && !storedActive;
  const versionLabel = engineLabel ?? (storedActive ? stored!.engineLabel : null);

  return (
    <section className={styles.panel} data-testid="analysis-panel" aria-label="Engine analysis">
      <div className={styles.headerRow}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={enabled ? styles.toggleOn : styles.toggleOff}
          onClick={() => controller.setEnabled(!enabled)}
          aria-label={enabled ? 'Turn engine off' : 'Turn engine on'}
          data-testid="engine-toggle"
        >
          <span className={styles.toggleKnob} />
        </button>
        <span className={styles.eval} data-testid="position-eval">
          {evalText ?? '\u2014'}
        </span>
        <span className={styles.status} data-testid="engine-status">
          {statusText}
        </span>
        <span className={styles.spacer} />
        {versionLabel && (
          <span className={styles.engineVersion} data-testid="engine-version">
            {versionLabel}
          </span>
        )}
        <EngineSettingsPopover
          settings={controller.settings}
          capabilities={capabilities}
          onChange={controller.setSettings}
          onApplyProfile={controller.applyProfile}
        />
        {rightSlot}
      </div>

      <div className={styles.depthRow} data-testid="engine-depth-row">
        {enabled ? (
          <span className={styles.depth}>
            {reachedDepth !== null ? `Depth: ${reachedDepth}` : 'Thinking\u2026'}
          </span>
        ) : storedActive && stored!.depth !== null ? (
          <span className={styles.depth}>Depth: {stored!.depth}</span>
        ) : (
          <span className={styles.depth}>Engine off</span>
        )}
        {analyzing && (
          <button
            type="button"
            className={styles.stop}
            onClick={controller.cancel}
            data-testid="engine-cancel"
          >
            Cancel
          </button>
        )}
      </div>

      {showIdle && (
        <p className={styles.hint} data-testid="engine-idle">
          Toggle the engine on to analyse this position.
        </p>
      )}

      {enabled && error && (
        <div className={styles.error} role="alert" data-testid="engine-error">
          <strong>Engine error.</strong> {error.message}
        </div>
      )}

      {showRegion && (
        <div className={styles.lines} data-testid="engine-result">
          {displayLines.map((line) => (
            <div className={styles.line} key={line.key}>
              <span className={styles.lineEval} data-testid={line.testId ?? 'engine-eval'}>
                {line.evalText}
              </span>
              <span
                className={styles.linePv}
                data-testid={line.testId ? `${line.testId}-pv` : 'engine-pv'}
              >
                {line.pvText}
              </span>
            </div>
          ))}
          {/* Keep the configured number of lines occupied so the panel height
              is stable while the engine is still reporting them (live mode
              only — stored content is never padded with empty rows). */}
          {enabled &&
            Array.from({
              length: Math.max(0, controller.settings.lines - displayLines.length),
            }).map((_, index) => (
              <div
                className={styles.placeholderLine}
                aria-hidden="true"
                key={`placeholder-${index}`}
                data-testid="engine-line-placeholder"
              />
            ))}
        </div>
      )}
    </section>
  );
}
